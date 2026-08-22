# Autoprint

Web platform for the automated 3D printing cell: printer fleet management
(PrusaLink), vision-based failure detection with automatic print stop, batch
print runs with robotic part removal, per-print timelapses, history with
failure-cause recording, and Telegram alerts.

SvelteKit (Svelte 5) + Tailwind v4 + PostgreSQL. Dark mode only.

## Architecture

```
Browser ── SvelteKit app (this repo, port 3000, session-cookie auth)
              │  PrusaLink v1 REST (X-Api-Key)          → Prusa XL/MK4/Core One
              │  MJPEG/snapshot proxy + failure webhook ← vision service (per camera, FastAPI :8080)
              │  POST /jobs, poll                       → robot_gateway (ROS 2, on the robot, :8090)
              │  Bot API                                → Telegram
              └─ PostgreSQL (docker compose, :5434)
```

- **Watcher** (`src/lib/server/orchestrator/watcher.ts`): polls each printer
  (3 s active / 15 s idle), mirrors prints into `print_jobs` rows (also prints
  started on the printer screen), emits events on state transitions.
- **Failure flow**: vision service `HTTP_POST_URL` → `POST
  /api/webhooks/vision/[printerId]` (X-Webhook-Token) → atomic per-job dedupe
  → save frame, Telegram photo alert → stop print if enabled → pause batch.
- **Batch runs** (`src/lib/server/orchestrator/batch.ts`): upload → print →
  robot removal → repeat ×n. Any trouble pauses the batch and waits for a
  human (resume-retry / resume-skip / cancel). Survives restarts.
- **Timelapse** (`src/lib/server/timelapse.ts`): vision snapshots every
  N seconds during a print, assembled with ffmpeg on completion.

## Development (no hardware)

```bash
docker compose up -d          # PostgreSQL on :5434
npm install
npm run mock:printer &        # fake PrusaLink on :8091, prints take 60 s
npm run mock:vision &         # fake camera/detector on :8092
npm run mock:robot &          # fake robot gateway on :8093
npm run dev -- --port 3000
```

Log in with password `autoprint` (change in Settings; seeded from
`INITIAL_PASSWORD` in `.env`). Add a printer with host `localhost:8091`,
vision URL `http://localhost:8092`, robot gateway `http://localhost:8093`.

Simulate a detected failure:
`curl -X POST http://localhost:8092/debug/fire-alert`
(start the mock with the webhook URL + secret shown in Settings → Vision webhook).

## Deployment (Jetson)

```bash
docker compose up -d
npm install && npm run build
node build                    # or a systemd unit; port 3000
```

Requires `ffmpeg` (`sudo apt install ffmpeg`). Set the vision services' env:
`HTTP_POST_URL` / `HTTP_POST_HEADERS_JSON` per printer (values shown in
Settings), and leave the vision service's own Telegram notifier off — the
platform sends the alerts.

### Why only the database is in compose

The app runs natively on the Jetson; `docker-compose.yml` holds nothing but
PostgreSQL. Reasons, in rough order of weight:

- It talks to LAN hardware — PrusaLink printers, a vision service per camera,
  the robot gateway on the robot itself. Staying on the host keeps those
  addresses the same ones you type into Settings.
- `src/lib/server/timelapse.ts` spawns `ffmpeg` directly, so a container image
  would have to carry it (and, on the Jetson, match its hardware encoders).
- Uploads, failure frames and timelapses live under `DATA_DIR` (`./data`),
  simpler as a plain directory than as a bind mount.
- `DATABASE_URL` points at `localhost:5434`, the published port, so one value
  works for `npm run dev` and for the deployed process alike.

Containerizing the app isn't ruled out — it would need a Dockerfile carrying
ffmpeg, `DATABASE_URL` switched to `db:5432`, and a decision about how the
container reaches the printers.

The robot side lives in
`yahboom_rosmaster_x3plus/src/yahboom_rosmaster/robot_gateway/` (see its
README for build + systemd).
