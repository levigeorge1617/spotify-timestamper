const path = require('path');
const express = require('express');
const { pool, init } = require('./db');
const { search } = require('./spotify');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PIN = process.env.ADMIN_PIN || '';

// How many songs one person can have waiting (pending + approved + playing) at once.
// A slot frees up as soon as one of their songs plays or is rejected.
const MAX_ACTIVE_REQUESTS = 3;

// How many upcoming songs the guest view shows.
const GUEST_UPNEXT_LIMIT = 10;

/* ---------------- settings helpers ---------------- */
async function getSetting(key, def) {
  const r = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  return r.rows.length ? r.rows[0].value : def;
}
async function setSetting(key, val) {
  await pool.query(
    'INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb',
    [key, JSON.stringify(val)]
  );
}

/* ---------------- Server-Sent Events ---------------- */
const publicClients = new Set(); // guest pages: now playing + up next
const adminClients = new Set();  // admin page: full state incl. pending
const playerClients = new Set(); // player page: skip/stop/play commands

function sseInit(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(':\n\n');
}

async function getPublicState() {
  const nowPlaying = await getSetting('now_playing', null);
  const upNext = (await pool.query(
    "SELECT id,name,artist,album_art,requested_by FROM queue_items WHERE status='approved' ORDER BY position ASC LIMIT $1",
    [GUEST_UPNEXT_LIMIT]
  )).rows;
  const total = (await pool.query("SELECT COUNT(*)::int c FROM queue_items WHERE status='approved'")).rows[0].c;
  return { nowPlaying, upNext, upNextTotal: total };
}
async function getAdminState() {
  const nowPlaying = await getSetting('now_playing', null);
  const upNext = (await pool.query(
    "SELECT id,uri,name,artist,album_art,requested_by,duration_ms FROM queue_items WHERE status='approved' ORDER BY position ASC"
  )).rows;
  const pending = (await pool.query(
    "SELECT id,uri,name,artist,album_art,requested_by,duration_ms,created_at FROM queue_items WHERE status='pending' ORDER BY created_at ASC"
  )).rows;
  const approvalMode = await getSetting('approval_mode', 'strict');
  return { nowPlaying, upNext, pending, approvalMode };
}
async function broadcast() {
  try {
    const pub = `data: ${JSON.stringify(await getPublicState())}\n\n`;
    for (const r of publicClients) r.write(pub);
    const adm = `data: ${JSON.stringify(await getAdminState())}\n\n`;
    for (const r of adminClients) r.write(adm);
  } catch (e) {
    console.error('broadcast error', e);
  }
}
function sendCommand(cmd) {
  const line = `data: ${JSON.stringify(cmd)}\n\n`;
  for (const r of playerClients) r.write(line);
}

function requireAdmin(req, res, next) {
  const pin = req.get('x-admin-pin') || req.query.pin;
  if (!ADMIN_PIN || pin !== ADMIN_PIN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* ---------------- public API ---------------- */
app.get('/api/config', (req, res) => res.json({ clientId: process.env.SPOTIFY_CLIENT_ID || '' }));

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  try {
    res.json({ results: await search(q) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/request', async (req, res) => {
  const b = req.body || {};
  if (!b.uri || !/^spotify:track:/.test(b.uri)) return res.status(400).json({ error: 'Invalid track' });
  const requestedBy = (b.requestedBy || 'Anonymous').toString().trim().slice(0, 40) || 'Anonymous';
  const requesterId = (b.requesterId || '').toString().slice(0, 64);

  // Per-person cap: count this requester's songs still in play (pending/approved/playing).
  if (requesterId) {
    const c = (await pool.query(
      "SELECT COUNT(*)::int n FROM queue_items WHERE requester_id=$1 AND status IN ('pending','approved','playing')",
      [requesterId]
    )).rows[0].n;
    if (c >= MAX_ACTIVE_REQUESTS) {
      return res.status(429).json({
        error: `You already have ${MAX_ACTIVE_REQUESTS} songs in the queue. Wait for one to play before adding another.`,
      });
    }
  }

  const mode = await getSetting('approval_mode', 'strict');
  const status = mode === 'auto' ? 'approved' : 'pending';
  let position = null;
  if (status === 'approved') {
    const m = await pool.query("SELECT COALESCE(MAX(position),0)+1 p FROM queue_items WHERE status='approved'");
    position = m.rows[0].p;
  }
  await pool.query(
    `INSERT INTO queue_items(uri,name,artist,album_art,duration_ms,requested_by,requester_id,status,position,approved_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [b.uri, (b.name || '').slice(0, 200), (b.artist || '').slice(0, 200), b.albumArt || '',
     b.durationMs || 0, requestedBy, requesterId || null, status, position, status === 'approved' ? new Date() : null]
  );
  await broadcast();
  res.json({ status });
});

app.get('/api/queue', async (req, res) => res.json(await getPublicState()));

app.get('/api/events', async (req, res) => {
  sseInit(res);
  publicClients.add(res);
  res.write(`data: ${JSON.stringify(await getPublicState())}\n\n`);
  req.on('close', () => publicClients.delete(res));
});

/* ---------------- admin API ---------------- */
app.post('/api/admin/login', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/events', requireAdmin, async (req, res) => {
  sseInit(res);
  adminClients.add(res);
  res.write(`data: ${JSON.stringify(await getAdminState())}\n\n`);
  req.on('close', () => adminClients.delete(res));
});

app.get('/api/admin/state', requireAdmin, async (req, res) => res.json(await getAdminState()));

app.post('/api/admin/approve/:id', requireAdmin, async (req, res) => {
  const m = await pool.query("SELECT COALESCE(MAX(position),0)+1 p FROM queue_items WHERE status='approved'");
  await pool.query(
    "UPDATE queue_items SET status='approved', position=$2, approved_at=now() WHERE id=$1 AND status='pending'",
    [req.params.id, m.rows[0].p]
  );
  await broadcast();
  res.json({ ok: true });
});
app.post('/api/admin/reject/:id', requireAdmin, async (req, res) => {
  await pool.query("UPDATE queue_items SET status='rejected' WHERE id=$1", [req.params.id]);
  await broadcast();
  res.json({ ok: true });
});
app.delete('/api/admin/item/:id', requireAdmin, async (req, res) => {
  await pool.query("UPDATE queue_items SET status='rejected' WHERE id=$1", [req.params.id]);
  await broadcast();
  res.json({ ok: true });
});
app.post('/api/admin/reorder', requireAdmin, async (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  for (let i = 0; i < ids.length; i++) {
    await pool.query("UPDATE queue_items SET position=$2 WHERE id=$1", [ids[i], i + 1]);
  }
  await broadcast();
  res.json({ ok: true });
});
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const mode = req.body && req.body.approvalMode;
  if (mode === 'strict' || mode === 'auto') await setSetting('approval_mode', mode);
  await broadcast();
  res.json({ ok: true });
});
app.post('/api/admin/skip', requireAdmin, (req, res) => { sendCommand({ type: 'skip' }); res.json({ ok: true }); });
app.post('/api/admin/stop', requireAdmin, (req, res) => { sendCommand({ type: 'stop' }); res.json({ ok: true }); });
app.post('/api/admin/play', requireAdmin, (req, res) => { sendCommand({ type: 'play' }); res.json({ ok: true }); });

/* ---- default (fallback) playlist ---- */
app.get('/api/admin/defaults', requireAdmin, async (req, res) => {
  res.json({
    tracks: (await pool.query(
      "SELECT id,uri,name,artist,album_art,duration_ms FROM default_tracks ORDER BY position ASC"
    )).rows,
  });
});
app.post('/api/admin/defaults', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.uri || !/^spotify:track:/.test(b.uri)) return res.status(400).json({ error: 'Invalid track' });
  const m = await pool.query('SELECT COALESCE(MAX(position),0)+1 p FROM default_tracks');
  await pool.query(
    'INSERT INTO default_tracks(uri,name,artist,album_art,duration_ms,position) VALUES($1,$2,$3,$4,$5,$6)',
    [b.uri, (b.name || '').slice(0, 200), (b.artist || '').slice(0, 200), b.albumArt || '', b.durationMs || 0, m.rows[0].p]
  );
  res.json({ ok: true });
});
app.delete('/api/admin/defaults/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM default_tracks WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
app.post('/api/admin/defaults/reorder', requireAdmin, async (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  for (let i = 0; i < ids.length; i++) {
    await pool.query('UPDATE default_tracks SET position=$2 WHERE id=$1', [ids[i], i + 1]);
  }
  res.json({ ok: true });
});

/* ---------------- player API (the Spotify-connected browser) ---------------- */
app.get('/api/player/events', requireAdmin, (req, res) => {
  sseInit(res);
  playerClients.add(res);
  req.on('close', () => playerClients.delete(res));
});

// Advance: mark the current song played, then hand back the next approved song,
// or the next default-playlist track when the approved queue is empty.
app.post('/api/player/next', requireAdmin, async (req, res) => {
  await pool.query("UPDATE queue_items SET status='played' WHERE status='playing'");
  const q = await pool.query("SELECT * FROM queue_items WHERE status='approved' ORDER BY position ASC LIMIT 1");
  let np = null;
  if (q.rows[0]) {
    const it = q.rows[0];
    await pool.query("UPDATE queue_items SET status='playing' WHERE id=$1", [it.id]);
    np = { source: 'queue', id: it.id, uri: it.uri, name: it.name, artist: it.artist,
           albumArt: it.album_art, durationMs: it.duration_ms, requestedBy: it.requested_by };
  } else {
    const defs = (await pool.query('SELECT * FROM default_tracks ORDER BY position ASC')).rows;
    if (defs.length) {
      let idx = await getSetting('default_index', 0);
      if (typeof idx !== 'number' || idx < 0) idx = 0;
      const it = defs[idx % defs.length];
      await setSetting('default_index', (idx + 1) % defs.length);
      np = { source: 'default', uri: it.uri, name: it.name, artist: it.artist,
             albumArt: it.album_art, durationMs: it.duration_ms };
    }
  }
  await setSetting('now_playing', np);
  await broadcast();
  res.json({ track: np });
});

app.post('/api/player/stop', requireAdmin, async (req, res) => {
  await pool.query("UPDATE queue_items SET status='played' WHERE status='playing'");
  await setSetting('now_playing', null);
  await broadcast();
  res.json({ ok: true });
});

/* ---------------- pages ---------------- */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jukebox.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/timestamper', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* keep SSE connections alive through proxies */
setInterval(() => {
  for (const set of [publicClients, adminClients, playerClients]) {
    for (const r of set) r.write(':\n\n');
  }
}, 25000);

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log('PA Jukebox listening on ' + PORT)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
