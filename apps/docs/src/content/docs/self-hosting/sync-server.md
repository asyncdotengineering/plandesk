---
title: Self-host the sync server
description: Run the Plan Desk collaboration sync server on your own Node box or container — SQLite-backed, no cloud required.
---

The collaboration tier has two planes: your **local-first workspace** (the source of truth) and a small **hosted sync server** — a rendezvous that holds participant sessions and a moderated submission inbox. [Cloudflare](/reference/collaboration/) is one way to run it; this page runs it on **your own host**. The store is portable SQLite (libSQL), so it needs nothing but Node and a writable directory.

The client view itself is **not** stored here. A share link is served as a read-only view **computed live** from the hosted project at read time — there is no pushed snapshot to go stale or drift. Sharing therefore requires the project to be hosted: promote it with `plandesk push --to <org-id>` first.

For a fully agent-driven deploy, `plandesk deploy fly | claude` or `plandesk deploy docker | claude` hand a coding agent a grounded runbook for those targets. This page is the manual version.

## Run it

The server ships as a binary in `@plandesk/sync-server` (≥ 0.4.2):

```bash
npx @plandesk/sync-server
# @plandesk/sync-server listening on http://localhost:3848 (db: ./sync.db)
```

Two environment variables configure it:

| Variable       | Default     | Purpose                                             |
| -------------- | ----------- | --------------------------------------------------- |
| `PORT`         | `3848`      | Port to listen on                                   |
| `SYNC_DB_PATH` | `./sync.db` | SQLite file (libSQL) — point at a persistent volume |

```bash
PORT=8080 SYNC_DB_PATH=/data/sync.db npx @plandesk/sync-server
```

The schema is created automatically on first start. Put `SYNC_DB_PATH` on a persistent disk — that file **is** your hosted state (shares, participants, submissions).

## Docker

```dockerfile
FROM node:22-slim
RUN npm i -g @plandesk/sync-server
ENV PORT=8080 SYNC_DB_PATH=/data/sync.db
VOLUME /data
EXPOSE 8080
CMD ["plandesk-sync-server"]
```

```bash
docker build -t plandesk-sync .
docker run -d -p 8080:8080 -v plandesk-sync-data:/data \
  -e SYNC_BOOTSTRAP_TOKEN="<your owner token>" plandesk-sync
```

For a fully agent-driven version of this, `plandesk deploy docker | claude` (or `fly`).

## Mint an owner sync token

The server authenticates the owner (you) with a **sync token**, stored only as a sha256 hash. The simplest way to seed it: generate a token, keep the plaintext locally, and hand the **same plaintext** to the server as `SYNC_BOOTSTRAP_TOKEN` — it hashes and seeds it on first boot (idempotent; a no-op if already present).

```bash
mkdir -p .plandesk && grep -qxF '.plandesk/sync-token' .gitignore || printf '.plandesk/sync-token\n' >> .gitignore
node -e '
const c = require("node:crypto"), fs = require("node:fs");
const token = "plandesk_sync_" + c.randomBytes(32).toString("base64url");
fs.writeFileSync(".plandesk/sync-token", token, { mode: 0o600 });
process.stdout.write(token + "\n");
'
```

Pass that token to the server (env var or Docker secret), then start it:

```bash
SYNC_BOOTSTRAP_TOKEN="<token>" SYNC_DB_PATH=/data/sync.db npx @plandesk/sync-server
# → "Seeded owner sync token from SYNC_BOOTSTRAP_TOKEN."
```

:::caution
The plaintext token lives **only** in git-ignored `.plandesk/sync-token` and the server's runtime env — never commit it, print it, or store it in `config.json`. The database holds only its hash.
:::

## Point your workspace at it

From your connected project, register against the server and push:

```bash
plandesk publish --remote http://your-host:8080
plandesk share create --audience "Acme Corp" --public --allow-submit
plandesk push          # or: plandesk sync --watch
```

See [Plan → share → build with your team](/guides/plan-share-build/) for the full collaboration loop.

## The client portal

Participants open the portal — the Plan Desk web app in read-only mode — which reads from your sync server via the build-time `VITE_SYNC_URL`. Build it once and serve the static output from any static host (or the same box behind your reverse proxy):

```bash
VITE_SYNC_URL="http://your-host:8080" pnpm --filter plandesk-web build
# serve apps/plandesk-web/dist/ as static files; SPA fallback: /* -> /index.html
```

The share link is then `<your-portal-url>/p/<shareToken>`.

## Production notes

- **TLS / reverse proxy** — put the server behind nginx/Caddy for HTTPS. The bundled server enables CORS on `/api/portal/*`; don't strip those headers at the proxy.
- **Single writer** — the SQLite store is single-machine by design. Run **one** instance against a given `SYNC_DB_PATH`; don't scale it horizontally.
- **Backups** — back up the `SYNC_DB_PATH` file; it's the entire hosted state.
- **Single-tenant** — one deployment serves one team. Multi-tenant org isolation is the gated [Phase 6](/reference/collaboration/#whats-not-here-yet).

See also: [Collaboration & sync](/reference/collaboration/) · [Docker (local app)](/self-hosting/docker/) · [Troubleshooting](/reference/troubleshooting/).
