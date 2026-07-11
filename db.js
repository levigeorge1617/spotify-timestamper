const { Pool } = require('pg');

const conn = process.env.DATABASE_URL;
// Render Postgres needs SSL; a local database usually does not.
const useSSL = conn && !/localhost|127\.0\.0\.1/.test(conn);

const pool = new Pool({
  connectionString: conn,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_items (
      id          SERIAL PRIMARY KEY,
      uri         TEXT NOT NULL,
      name        TEXT NOT NULL,
      artist      TEXT,
      album_art   TEXT,
      duration_ms INTEGER DEFAULT 0,
      requested_by TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      position    DOUBLE PRECISION,
      created_at  TIMESTAMPTZ DEFAULT now(),
      approved_at TIMESTAMPTZ
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS default_tracks (
      id          SERIAL PRIMARY KEY,
      uri         TEXT NOT NULL,
      name        TEXT NOT NULL,
      artist      TEXT,
      album_art   TEXT,
      duration_ms INTEGER DEFAULT 0,
      position    DOUBLE PRECISION
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB
    )`);

  // migrations for existing databases (no-op if already applied)
  await pool.query('ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS requester_id TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_queue_requester ON queue_items(requester_id, status)');

  // seed defaults (no-op if already present)
  await pool.query("INSERT INTO settings(key,value) VALUES('approval_mode','\"strict\"'::jsonb) ON CONFLICT (key) DO NOTHING");
  await pool.query("INSERT INTO settings(key,value) VALUES('default_index','0'::jsonb) ON CONFLICT (key) DO NOTHING");
  await pool.query("INSERT INTO settings(key,value) VALUES('queue_open','true'::jsonb) ON CONFLICT (key) DO NOTHING");
}

module.exports = { pool, init };
