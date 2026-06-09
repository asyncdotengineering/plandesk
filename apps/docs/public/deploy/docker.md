---
target: docker
store: libsql
website: https://docs.docker.com
summary: Run the Plan Desk sync server as a Docker container on any host, with SQLite (libSQL) on a mounted volume.
---

# Deploy Plan Desk's sync server with Docker

You are an AI coding agent deploying Plan Desk's **hosted sync tier** as a Docker container on a host the user controls. Follow these instructions exactly; confirm with the user only when something is genuinely ambiguous (an unusual host, an existing container, where the volume should live). Your job: run the sync server, wire the user's local project to it, and produce a shareable client-portal link.

This is the rendezvous tier only — it holds the curated projections the owner pushes, never the local source of truth. Read [the collaboration architecture](https://plandesk.asyncdot.com/reference/collaboration/) if you need the model.

Work from the **repo root**. Run steps in order. Don't skip verification.

## Secrets — non-negotiable

This deploy mints one secret: the owner **sync token**.

- The plaintext is written **only** to `.plandesk/sync-token` (git-ignored) and passed to the container as `SYNC_BOOTSTRAP_TOKEN`.
- The server stores **only its sha256 hash**. Never commit the plaintext, print it, or bake it into the image.
- Pass it at **runtime** (`-e`/secrets), never in the `Dockerfile` or `docker build`.

## Prerequisites

```bash
docker --version
node --version   # for the token mint step
```

## Step 1 — Mint the owner token

```bash
mkdir -p .plandesk
grep -qxF '.plandesk/sync-token' .gitignore || printf '.plandesk/sync-token\n' >> .gitignore

node -e '
const c = require("node:crypto"), fs = require("node:fs");
const token = "plandesk_sync_" + c.randomBytes(32).toString("base64url");
fs.writeFileSync(".plandesk/sync-token", token, { mode: 0o600 });
process.stdout.write(token + "\n");   // you pass this to the container as SYNC_BOOTSTRAP_TOKEN
'
```

Keep the printed token for Step 3. The server hashes it on boot and seeds the owner token — no database surgery.

## Step 2 — Write the Dockerfile

```dockerfile
# Dockerfile.sync
FROM node:22-slim
RUN npm i -g @plandesk/sync-server
ENV PORT=8080 SYNC_DB_PATH=/data/sync.db
VOLUME /data
EXPOSE 8080
CMD ["plandesk-sync-server"]
```

```bash
docker build -f Dockerfile.sync -t plandesk-sync .
```

## Step 3 — Run it (idempotent)

If a container named `plandesk-sync` is already running, reuse it — don't double-run on the same port/volume. Otherwise:

```bash
docker run -d --name plandesk-sync \
  -p 8080:8080 \
  -v plandesk-sync-data:/data \
  -e SYNC_BOOTSTRAP_TOKEN="<token from Step 1>" \
  plandesk-sync
docker logs plandesk-sync | tail   # expect: "listening on …" + "Seeded owner sync token…"
```

The named volume persists `/data/sync.db` — that file is your entire hosted state. **`SYNC_URL`** is `http://<host>:8080` (use the host's reachable address/domain; put TLS in front for anything public).

## Step 4 — Wire your project and create a share

```bash
plandesk publish --remote "$SYNC_URL"                          # registers the global project
plandesk share create --audience "Demo client" --public --allow-submit
plandesk push                                                  # …or: plandesk sync --watch
```

`share create` prints a `plandesk_share_…` token and the link template.

## Step 5 — Build and serve the portal

The portal is the Plan Desk web app in read-only mode; it reads from `SYNC_URL` via a build-time variable, and client-routes `/p/:token` (so it needs an SPA fallback — already in source as `public/_redirects`):

```bash
VITE_SYNC_URL="$SYNC_URL" pnpm --filter plandesk-web build
# serve apps/plandesk-web/dist/ from any static host (nginx, `npx serve`, a CDN)
```

The share link is `<portal-url>/p/<shareToken>`.

## Step 6 — Verify

```bash
curl -s "$SYNC_URL/api/portal/v1/shares/<shareToken>/meta" | jq .
curl -s -X POST "$SYNC_URL/api/portal/v1/shares/<shareToken>/join" \
  -H 'content-type: application/json' -d '{"name":"Smoke Test"}'
```

Then open `<portal-url>/p/<shareToken>`: the named-join gate, then the read-only board. Run `plandesk sync --watch` and flip a task locally — the portal updates within a few seconds.

## Report back

- **Sync server:** `$SYNC_URL` (Docker container `plandesk-sync`, volume `plandesk-sync-data`).
- **Portal + share link:** `<portal-url>/p/<shareToken>`.
- Owner token: in `.plandesk/sync-token` (git-ignored) and the container's `SYNC_BOOTSTRAP_TOKEN`; only its hash is stored. Don't commit it.
- Live updates: `plandesk sync --watch`.

If any step failed, report which and the exact error — don't paper over a half-running deploy.
