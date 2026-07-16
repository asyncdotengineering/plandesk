---
target: fly
store: libsql
website: https://fly.io/docs
summary: Run the Plan Desk API on Fly.io — one small machine, auto-stop, SQLite on a Fly volume.
---

# Deploy Plan Desk API to Fly.io

You are an AI coding agent deploying Plan Desk's **single hosted API** to the user's Fly.io account. Follow these instructions exactly. Your job: run the API, wire the local project to it, and produce a shareable client-portal link.

There is **no separate sync-server**. Architecture: [Collaboration](https://plandesk.asyncdot.com/reference/collaboration/).

## Shape of this deploy — do not deviate

SQLite on a single volume:

- **One machine.** Never scale to 2+.
- **Smallest VM.** `shared-cpu-1x`, `256mb` — raise only on observed OOM.
- **Auto-stop on.** `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0`.
- **Never provision Fly Postgres.**

## Prerequisites

```bash
flyctl version
flyctl auth whoami   # if not authed, STOP and ask the user to run `flyctl auth login`
```

## Step 1 — Dockerfile and fly.toml

```dockerfile
# Dockerfile.plandesk
FROM node:22-slim
RUN npm i -g @plandesk/cli
ENV PLANDESK_HOST=0.0.0.0 PLANDESK_PORT=8080 PLANDESK_DATA_DIR=/data
EXPOSE 8080
CMD ["plandesk", "serve", "--host", "0.0.0.0", "--port", "8080", "--data-dir", "/data"]
```

```toml
# fly.toml
app = "plandesk-api-<unique>"
primary_region = "<region, e.g. iad>"

[build]
dockerfile = "Dockerfile.plandesk"

[http_service]
internal_port = 8080
force_https = true
auto_stop_machines = "stop"
auto_start_machines = true
min_machines_running = 0

[mounts]
source = "plandesk_api_data"
destination = "/data"

[[vm]]
size = "shared-cpu-1x"
memory = "256mb"
```

## Step 2 — Create app, volume, secret, deploy

```bash
flyctl apps create plandesk-api-<unique>
flyctl volumes create plandesk_api_data --app plandesk-api-<unique> --region <region> --size 1 --yes
flyctl secrets set PLANDESK_AUTH_PASSWORD="<strong-password>" --app plandesk-api-<unique>
flyctl deploy --app plandesk-api-<unique> --ha=false
```

**API_URL** is `https://plandesk-api-<unique>.fly.dev`.

## Step 3 — Wire project and share

```bash
plandesk login --server "$API_URL"
plandesk push --to <org-id>
plandesk share create --audience "Demo client" --public --allow-submit
```

## Step 4 — Verify

```bash
curl -s "$API_URL/api/v1/share/<shareToken>/meta" | jq .
```

Open `$API_URL/p/<shareToken>`, join by name, view the board.

## Report back

- **API:** `$API_URL` (single machine, auto-stop, volume `plandesk_api_data`).
- **Share link:** `$API_URL/p/<shareToken>`.
- No Fly Postgres — store is the SQLite volume.
