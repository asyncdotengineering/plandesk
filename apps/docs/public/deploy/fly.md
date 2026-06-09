---
target: fly
store: libsql
website: https://fly.io/docs
summary: Run the Plan Desk sync server on Fly.io — a single small machine, auto-stop, with SQLite (libSQL) on a Fly volume.
---

# Deploy Plan Desk's sync server to Fly.io

You are an AI coding agent deploying Plan Desk's **hosted sync tier** to the user's own Fly.io account. Follow these instructions exactly; confirm with the user only when something is genuinely ambiguous (an existing app, region choice). Your job: run the sync server, wire the user's local project to it, and produce a shareable client-portal link.

This is the rendezvous tier only — curated projections the owner pushes, never the local source of truth. Architecture: [Collaboration & sync](https://plandesk.asyncdot.com/reference/collaboration/).

## Shape of this deploy — do not deviate

The sync server is **SQLite on a single volume**, so this is deliberately small and single-machine:

- **One machine.** A volume binds to one machine; never scale to 2+ (SQLite is single-writer).
- **Smallest VM.** `shared-cpu-1x`, `256mb` — raise only on observed OOM.
- **Auto-stop on.** `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0` — it wakes on request (a brief cold start is fine for a collaboration server).
- **Never provision Fly Postgres.** The store is the SQLite file on the volume. Do not create or attach a database.

## Secrets — non-negotiable

The owner **sync token** plaintext goes **only** to git-ignored `.plandesk/sync-token` and to Fly as a **secret** (`SYNC_BOOTSTRAP_TOKEN`). The server stores only its sha256 hash. Never commit it, print it, or put it in `fly.toml`.

## Prerequisites

```bash
flyctl version
flyctl auth whoami   # if not authed, STOP and ask the user to run `flyctl auth login`
node --version
```

## Step 1 — Mint the owner token

```bash
mkdir -p .plandesk
grep -qxF '.plandesk/sync-token' .gitignore || printf '.plandesk/sync-token\n' >> .gitignore

node -e '
const c = require("node:crypto"), fs = require("node:fs");
const token = "plandesk_sync_" + c.randomBytes(32).toString("base64url");
fs.writeFileSync(".plandesk/sync-token", token, { mode: 0o600 });
process.stdout.write(token + "\n");
'
```

Keep the printed token for Step 4.

## Step 2 — Write the Dockerfile and fly.toml

```dockerfile
# Dockerfile.sync
FROM node:22-slim
RUN npm i -g @plandesk/sync-server
ENV PORT=8080 SYNC_DB_PATH=/data/sync.db
EXPOSE 8080
CMD ["plandesk-sync-server"]
```

```toml
# fly.toml  — pick a unique app name
app = "plandesk-sync-<unique>"
primary_region = "<region, e.g. iad>"

[build]
dockerfile = "Dockerfile.sync"

[http_service]
internal_port = 8080
force_https = true
auto_stop_machines = "stop"
auto_start_machines = true
min_machines_running = 0

[mounts]
source = "plandesk_sync_data"
destination = "/data"

[[vm]]
size = "shared-cpu-1x"
memory = "256mb"
```

## Step 3 — Create the app and volume

```bash
flyctl apps create plandesk-sync-<unique>            # or: flyctl launch --no-deploy --copy-config
flyctl volumes create plandesk_sync_data --app plandesk-sync-<unique> --region <region> --size 1 --yes
```

Create **one** volume only — one machine.

## Step 4 — Set the token secret and deploy

```bash
flyctl secrets set SYNC_BOOTSTRAP_TOKEN="<token from Step 1>" --app plandesk-sync-<unique>
flyctl deploy --app plandesk-sync-<unique> --ha=false
```

`--ha=false` keeps it to a single machine. **`SYNC_URL`** is `https://plandesk-sync-<unique>.fly.dev`. Confirm the boot log seeded the token:

```bash
flyctl logs --app plandesk-sync-<unique> | grep -i "listening\|Seeded owner"
```

## Step 5 — Wire your project and create a share

```bash
plandesk publish --remote "$SYNC_URL"
plandesk share create --audience "Demo client" --public --allow-submit
plandesk push                         # …or: plandesk sync --watch
```

## Step 6 — Build and serve the portal

```bash
VITE_SYNC_URL="$SYNC_URL" pnpm --filter plandesk-web build
# serve apps/plandesk-web/dist/ from any static host; SPA fallback ships in source
```

The share link is `<portal-url>/p/<shareToken>`.

## Step 7 — Verify

```bash
curl -s "$SYNC_URL/api/portal/v1/shares/<shareToken>/meta" | jq .
```

Open `<portal-url>/p/<shareToken>`, join by name, see the read-only board. Flip a task locally with `plandesk sync --watch` running — it updates within seconds (allow a moment if the machine was auto-stopped).

## Report back

- **Sync server:** `$SYNC_URL` (Fly app `plandesk-sync-<unique>`, single `shared-cpu-1x` machine, auto-stop, volume `plandesk_sync_data`).
- **Portal + share link:** `<portal-url>/p/<shareToken>`.
- Owner token: `.plandesk/sync-token` (git-ignored) + Fly secret `SYNC_BOOTSTRAP_TOKEN`; only the hash is stored.
- No Fly Postgres was created — the store is the SQLite volume.

If any step failed, report which and the exact error.
