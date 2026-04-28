# 2026 EOYS Layout

Collaborative 3D room layout tool. Served at [eoys.adamvosburgh.com](https://eoys.adamvosburgh.com).

## Stack

- **Frontend:** Vite + Three.js + Yjs (real-time sync via y-websocket)
- **Backend:** Node/Express, SQLite (`node:sqlite`), served on port 3001
- **Infra:** Docker Compose, Cloudflare Tunnel (tunneled through the host's standalone `cloudflared` container)

## Deployment

### Prerequisites

- Docker + Docker Compose
- `git-lfs` installed and initialized (`git lfs install`) — room GLB models are stored in LFS
- `.env` file in repo root (see `.env.template`)

### First run

```bash
git lfs pull                          # fetch actual GLB model files
cp .env.template .env                 # fill in VITE_WS_URL and PORT
docker compose up -d app --build
```

### After pulling changes from origin

```bash
git pull
git lfs pull                          # if models changed
docker compose up -d app --build      # rebuilds image and restarts container
```

### Logs

```bash
docker compose logs -f app
```

### Stop

```bash
docker compose down
```

## Cloudflare Tunnel

Traffic is routed via the host's existing `cloudflared` Docker container (not the one in this compose file — that service is unused). The public hostname `eoys.adamvosburgh.com` in the Cloudflare Zero Trust dashboard points to `http://host.docker.internal:3001`.

## Adding rooms

Process room scans with the layout generator pipeline, then place the output in `public/models/<slug>/`. The server auto-imports `scan_objects.json` on startup.

## Assets

Uploaded via `/admin`. Files land in `./storage/assets/` (volume-mounted). Uploaded assets must be approved in the admin panel before they appear in the main app library.

## Data persistence

| What | Host path |
|---|---|
| SQLite DB | `./data/layout.db` |
| Uploaded assets | `./storage/assets/` |
| Room models | `./public/models/` |
