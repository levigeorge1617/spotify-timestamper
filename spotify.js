// Server-side Spotify search using the client-credentials flow.
// This keeps the client secret on the server so guests never need a Spotify account.

let tokenCache = { token: null, exp: 0 };

async function getAppToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not configured');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Spotify token request failed: ' + JSON.stringify(data));
  tokenCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

// Spotify's Feb 2026 API change capped the search endpoint's limit at 10 (was 50).
async function search(q, limit = 10) {
  const token = await getAppToken();
  const url = 'https://api.spotify.com/v1/search?type=track&limit=' + limit + '&q=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.tracks && data.tracks.items || []).map(t => ({
    uri: t.uri,
    name: t.name,
    artist: t.artists.map(a => a.name).join(', '),
    albumArt: (t.album && t.album.images && (t.album.images[2] || t.album.images[0]) || {}).url || '',
    durationMs: t.duration_ms,
  }));
}

module.exports = { search };
