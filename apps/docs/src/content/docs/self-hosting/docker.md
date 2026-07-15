---
title: Docker (self-host)
description: Run the Plan Desk server as a container on your own host — the Dockerfile.server image and docker-compose.hosted.yml quickstart.
---

The **server image** (`Dockerfile.server`) runs the full Plan Desk server on a host you control — the [self-host topology](./topologies/). You bring the database; there is no dependency on asyncdot infrastructure and no GitHub app required.

## Quickstart (compose)

```bash
export PLANDESK_AUTH_PASSWORD='choose-a-strong-password'
docker compose -f docker-compose.hosted.yml up --build
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

By default this uses a local SQLite file on a Docker volume (migrated automatically at boot). For a **durable** database, point it at your own libSQL/Turso database and apply the schema once:

```bash
export PLANDESK_DB_URL='libsql://your-db.turso.io'
export PLANDESK_DB_TOKEN='<libSQL auth token>'

# Apply the schema once (you own this database — REQ-8)
docker compose -f docker-compose.hosted.yml run --rm plandesk \
  migrate --db "$PLANDESK_DB_URL" --db-token "$PLANDESK_DB_TOKEN"

docker compose -f docker-compose.hosted.yml up --build
```

## Build the image directly

```bash
docker build -f Dockerfile.server -t plandesk-server .
docker run -p 3847:3847 \
  -e PLANDESK_DB_URL='libsql://your-db.turso.io' \
  -e PLANDESK_DB_TOKEN='<token>' \
  -e PLANDESK_AUTH_PASSWORD='<password>' \
  plandesk-server
```

## Configuration

Everything the server needs can be set by **environment** or by a [`plandesk.server.json` file](./server-config/) mounted at `/data/plandesk.server.json` (env always wins). Inspect the resolved config and its source with `plandesk doctor` — secret values are redacted:

```bash
docker compose -f docker-compose.hosted.yml run --rm plandesk doctor
```

## Securing the server

- **`PLANDESK_AUTH_PASSWORD`** enables HTTP basic-auth on the UI and REST API. Set it for any host reachable beyond your own machine. Without it the server is open — fine on a trusted LAN, not for a public host.
- **TLS** — front the container with nginx/Caddy for HTTPS. The server binds `0.0.0.0` inside the container; do the TLS termination at your reverse proxy.
- **GitHub sign-in is optional** — omit the GitHub env/keys and the server runs with token auth only ([REQ-20](#)).

## Data persistence

- **Local file topology** (no `PLANDESK_DB_URL`): state lives in the `plandesk-data` volume (`/data` in the container). Back up the volume.
- **Remote DB topology** (`PLANDESK_DB_URL` set): state lives in your database. Back that up. The volume then only holds `plandesk.server.json`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLANDESK_DB_URL` | (unset → local file) | libSQL/Turso URL for the server's database |
| `PLANDESK_DB_TOKEN` | (unset) | Auth token for a remote libSQL DB (**secret**) |
| `PLANDESK_HOST` | `0.0.0.0` | Bind address |
| `PLANDESK_PORT` | `3847` | Bind port |
| `PLANDESK_AUTH_PASSWORD` | (unset) | HTTP basic-auth password (**secret**) |
| `PLANDESK_STORAGE` | `local` | `local` (blobs in DB) or `s3` |
| `PLANDESK_S3_*` | (unset) | S3 credentials when `PLANDESK_STORAGE=s3` |
| `PLANDESK_GITHUB_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL` | (unset) | GitHub OAuth (all-or-nothing; omit for no GitHub sign-in) |

## Next

- [Deployment topologies](./topologies/) — local vs self-host vs free-hosted, and who runs migrations.
- [Server configuration](./server-config/) — the full `plandesk.server.json` reference.
- [Collaboration & sync](/reference/collaboration/) — the optional *hosted sync server* (a separate, smaller service for sharing projects with external clients).
