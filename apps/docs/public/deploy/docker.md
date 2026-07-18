---
target: docker
store: libsql
website: https://docs.docker.com
summary: Run the Plan Desk API (portal + projects + moderated submissions) as a Docker container with SQLite on a mounted volume.
---

# Deploy Plan Desk API with Docker

You are an AI coding agent deploying Plan Desk's **single hosted API** as a Docker container on a host the user controls. Follow these instructions exactly; confirm with the user only when something is genuinely ambiguous. Your job: run the API, wire the user's local project to it, and produce a shareable client-portal link.

There is **no separate sync-server package**. Guest join, portal view, and moderated submissions all run on `@plandesk/api`. See [collaboration architecture](https://plandesk.asyncdot.com/reference/collaboration/).

Work from the **repo root**. Run steps in order. Don't skip verification.

## Prerequisites

```bash
docker --version
node --version
```

## Step 1 — Prefer the shipped compose file when present

If `docker-compose.hosted.yml` exists in the checkout:

```bash
export PLANDESK_AUTH_PASSWORD='choose-a-strong-password'
docker compose -f docker-compose.hosted.yml up --build -d
```

**API URL** is `http://<host>:7526` (or the port in the compose file). Skip to Step 4.

## Step 2 — Or build a minimal image from the published CLI

```dockerfile
# Dockerfile.plandesk
FROM node:22-slim
RUN npm i -g @plandesk/cli
ENV PLANDESK_HOST=0.0.0.0 PLANDESK_PORT=7526 PLANDESK_DATA_DIR=/data
VOLUME /data
EXPOSE 7526
CMD ["plandesk", "serve", "--host", "0.0.0.0", "--port", "7526", "--data-dir", "/data"]
```

```bash
docker build -f Dockerfile.plandesk -t plandesk-api .
```

## Step 3 — Run it

```bash
docker run -d --name plandesk-api \
  -p 7526:7526 \
  -v plandesk-api-data:/data \
  -e PLANDESK_AUTH_PASSWORD="<strong-password>" \
  plandesk-api
docker logs plandesk-api | tail
```

**API_URL** is `http://<host>:7526` (use a reachable address; put TLS in front for anything public).

## Step 4 — Wire your project and create a share

```bash
plandesk login --server "$API_URL"   # or write .plandesk/token + config serverUrl
plandesk push --to <org-id>
plandesk share create --audience "Demo client" --public --allow-submit
```

`share create` prints a `plandesk_share_…` token and the portal link template.

## Step 5 — Portal

The portal is the same web app, guest mode at `/p/:shareToken`, served by the API (or a static build of `apps/plandesk-web` pointed at this origin). No `VITE_SYNC_URL` — submissions use `/api/v1/share/:token/submissions` on this API.

## Step 6 — Verify

```bash
curl -s "$API_URL/api/v1/share/<shareToken>/meta" | jq .
curl -s -X POST "$API_URL/api/v1/share/<shareToken>/join" \
  -H 'content-type: application/json' -d '{"name":"Smoke Test"}'
```

Open `<api-or-portal-url>/p/<shareToken>`: named join, then the read-only board. Submit an issue if the share allows it; it appears in owner triage on the same server.

## Report back

- **API:** `$API_URL` (container `plandesk-api`, volume `plandesk-api-data`).
- **Portal + share link:** `<url>/p/<shareToken>`.
- Auth password / tokens: env or git-ignored files only — never commit.

If any step failed, report which and the exact error — don't paper over a half-running deploy.
