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

The app runs as a plain node process on `127.0.0.1:3000` behind nginx, which
terminates HTTPS with a certificate issued by Tailscale. Open it at
**`https://<jetson>.<tailnet>.ts.net`** (the MagicDNS name from
`tailscale status`), not at the raw Tailscale IP: the certificate is only valid
for that name.

Why the proxy setup matters: SvelteKit rejects every form POST whose `Origin`
header differs from the origin it thinks it is serving
(`Cross-site POST form submissions are forbidden`). adapter-node derives that
origin from `X-Forwarded-Proto` / `X-Forwarded-Host` when `PROTOCOL_HEADER` /
`HOST_HEADER` are set, and otherwise assumes `https`. Serving plain http on
`:3000` with none of them set therefore breaks every action in the UI.

Prerequisites: MagicDNS and **HTTPS Certificates** enabled for the tailnet
(admin console → DNS), plus `sudo apt install nginx ffmpeg`.

```bash
# 1. certificate (also installs into /etc/ssl/tailscale; rerun daily from cron, see script)
sudo deploy/renew-tailscale-cert.sh

# 2. nginx — replace JETSON.TAILNET.ts.net in the file with your MagicDNS name
sudo cp deploy/nginx/autoprint.conf /etc/nginx/sites-available/autoprint
sudo ln -s /etc/nginx/sites-available/autoprint /etc/nginx/sites-enabled/autoprint
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 3. app
docker compose up -d                        # PostgreSQL on :5434
cp .env.example .env                        # keep the "Production behind nginx" block
npm ci && npm run build
readlink -f "$(which node)"                  # put this Node (>= 20.19) path in ExecStart= of the unit
sudo cp deploy/autoprint.service /etc/systemd/system/   # edit User/WorkingDirectory/EnvironmentFile/ExecStart
sudo systemctl daemon-reload && sudo systemctl enable --now autoprint
journalctl -u autoprint -f
```

`npm start` (`node --env-file=.env build`) runs the same thing in the
foreground. The `.env` production block sets `HOST=127.0.0.1`,
`PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER` and
`BODY_SIZE_LIMIT=Infinity` (adapter-node otherwise caps request bodies at
512 KB, which blocks g-code uploads). If you would rather pin the origin than
trust the headers, set `ORIGIN=https://<jetson>.<tailnet>.ts.net` instead.

Add to root's crontab so the certificate is renewed before it expires:

```
0 4 * * * /home/jetson/auto-print/deploy/renew-tailscale-cert.sh >> /var/log/autoprint-cert.log 2>&1
```

Set the vision services' env: `HTTP_POST_URL` / `HTTP_POST_HEADERS_JSON` per
printer (values shown in Settings; they now carry the https MagicDNS origin).
A vision service running on the Jetson itself can also post to
`http://127.0.0.1:3000/api/webhooks/vision/<id>` (JSON webhooks are not subject
to the form CSRF check). Leave the vision service's own Telegram notifier off —
the platform sends the alerts.

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
