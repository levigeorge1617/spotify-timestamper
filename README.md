# spotify-timestamper

Two things live in this repo:

- **PA Jukebox** — a shared, approval-based song queue for playing music through a building PA system. Guests request songs, you approve them, and one Spotify-connected browser plays them through the PA. A configurable "house playlist" plays whenever the queue is empty, so there's always something on. Runs as a Node/Express service on Render.
- **Playlist Timestamper** — the original static tool (`index.html`), now served at `/timestamper`.

## How the jukebox works

| Page | Who | What |
|------|-----|------|
| `/`        | Guests  | Search Spotify, request a song, see Now Playing + Up Next. No Spotify account needed. |
| `/admin`   | You     | Approve/reject requests, reorder or skip, edit the house playlist, switch approval mode. PIN-protected. |
| `/player`  | You     | The Spotify-Premium browser wired to the PA. Plays the approved queue, falls back to the house playlist. PIN + Spotify login. |

Shared state lives in Postgres; live updates are pushed to every page over Server-Sent Events. Guest search runs **server-side** with the Spotify client-credentials flow, so your client secret never reaches the browser and guests don't need to log in.

**Approval mode** starts as **strict** (nothing plays until you approve it). You can flip it to **auto** (requests play automatically, you can still veto/skip) any time on the admin page.

## One-time setup

### 1. Spotify app
In the [Spotify developer dashboard](https://developer.spotify.com/dashboard):
- Open your app (or create one) and note the **Client ID** and **Client Secret**.
- Under **Edit Settings → Redirect URIs**, add your player URL:
  `https://YOUR-RENDER-URL/player` (e.g. `https://pa-jukebox.onrender.com/player`).
  Add a custom-domain version too if you set one up. This must match exactly.

### 2. Deploy on Render
Easiest path — **Blueprint** (uses `render.yaml`):
1. Push this repo to GitHub (already done for this branch).
2. In Render: **New → Blueprint**, pick this repo. It creates the web service **and** a Postgres database, wiring `DATABASE_URL` automatically.
3. When prompted, fill in the three secrets: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `ADMIN_PIN`.

Manual path instead of the Blueprint:
1. **New → Postgres**, create a database, copy its **Internal Database URL**.
2. **New → Web Service**, point at this repo.
   - Build command: `npm install`
   - Start command: `node server.js`
3. Add environment variables:
   - `DATABASE_URL` = the internal database URL from step 1
   - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` = from the Spotify dashboard
   - `ADMIN_PIN` = any private PIN you choose

The database tables are created automatically on first boot.

### 3. First run
1. Go to `/admin`, enter your PIN, and add a few songs to the **house playlist**.
2. On the PA machine, open `/player`: enter the PIN, connect Spotify (Premium), pick the output device, and hit **Start jukebox**.
3. Share the base URL (`/`) with people so they can start requesting.

## Local development
```bash
npm install
cp .env.example .env      # fill in the values; point DATABASE_URL at a local Postgres
npm start                 # http://localhost:3000
```

## Environment variables
| Var | Purpose |
|-----|---------|
| `SPOTIFY_CLIENT_ID` | Spotify app client ID (also exposed to the player page for login) |
| `SPOTIFY_CLIENT_SECRET` | Spotify app secret — server-side only, used for guest search |
| `ADMIN_PIN` | Unlocks `/admin` and `/player` |
| `DATABASE_URL` | Postgres connection string (Render provides this) |
| `PORT` | Port to listen on (Render sets this) |
