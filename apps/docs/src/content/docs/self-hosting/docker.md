---
title: Docker (self-host)
description: Run the Plan Desk server as a container on your own host — the Dockerfile image and compose.yaml quickstart.
---

The **server image** (`Dockerfile`, built locally; nothing is published to a registry) runs the full Plan Desk server on a host you control — the [self-host topology](./topologies/). You bring the database; there is no dependency on asyncdot infrastructure and no GitHub app required.

## Quickstart (compose)

```bash
cp .env.example .env   # set PLANDESK_AUTH_PASSWORD and PLANDESK_BETTER_AUTH_SECRET (openssl rand -hex 32)
docker compose up --build -d
```

Open [http://127.0.0.1:7526](http://127.0.0.1:7526). Set `PLANDESK_HOST_PORT` in `.env` to publish on another host port.

By default this uses a local SQLite file on the `plandesk-data` volume. For a **durable** database, set your own libSQL/Turso database in `.env`:

```bash
PLANDESK_DB_URL=libsql://your-db.turso.io
PLANDESK_DB_TOKEN=<libSQL auth token>
```

Either way the server migrates its database at boot, under a lease so only one instance migrates at a time. An instance that can't take the lease within 30 s answers `503 schema_behind` and keeps retrying until the schema is current. `plandesk migrate` remains for operators who prefer a CI step.

## Build the image directly

```bash
docker build -t plandesk:local .
docker run -p 127.0.0.1:7526:7526 -v plandesk-data:/data \
  -e PLANDESK_AUTH_PASSWORD='<password>' \
  -e PLANDESK_BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  plandesk:local
```

The image runs as a non-root user, keeps its data in `/data`, listens on 7526 and reports health to Docker from `/api/v1/health`. Its entrypoint is the `plandesk` CLI, so `docker run --rm plandesk:local doctor` runs any other command.

## Configuration

Everything the server needs can be set by **environment** or by a [`plandesk.server.json` file](./server-config/) mounted at `/data/plandesk.server.json` (env always wins). Inspect the resolved config and its source with `plandesk doctor` — secret values are redacted:

```bash
docker compose run --rm plandesk doctor
```

## Securing the server

### The bind address is the trust boundary

Plan Desk treats a **loopback bind** — `127.0.0.1`, `::1` or `localhost` — as proof that only this
machine can reach it. On a loopback bind every request is the org owner, with no login at all. That
is what makes a local board zero-setup: you run `plandesk serve`, open the browser, and it works.

On any other bind address that trust is gone and better-auth does the authenticating.

**So do not bind loopback and put a reverse proxy in front of it.** That shape is normally good
practice — keep the app port off the network, terminate TLS at nginx or Caddy — but here it defeats
the model: the server still believes only this machine can reach it, while the proxy hands the
internet an owner session. There is no error and nothing in the UI looks wrong; the board simply has
no access control.

Two safe shapes:

|                  | Bind        | Who can reach it            | Authentication                            |
| ---------------- | ----------- | --------------------------- | ----------------------------------------- |
| **Local board**  | `127.0.0.1` | this machine only, no proxy | none needed — loopback is the boundary    |
| **Served board** | `0.0.0.0`   | proxy or network            | better-auth, and `PLANDESK_AUTH_PASSWORD` |

The image already does the right thing: it binds `0.0.0.0`, and compose publishes the port on
the host's `127.0.0.1` only. The container's network isolation, not a loopback bind, keeps it private.

### Other controls

- **`PLANDESK_AUTH_PASSWORD`** enables HTTP basic-auth on the UI and REST API. Set it for any host reachable beyond your own machine. Without it the server is open — fine on a trusted LAN, not for a public host.
- **TLS** — front the container with nginx/Caddy for HTTPS. The server binds `0.0.0.0` inside the container; do the TLS termination at your reverse proxy.
- **GitHub sign-in is optional** — omit the GitHub env/keys and the server runs with token auth only ([REQ-20](#)).

## Data persistence

- **Local file topology** (no `PLANDESK_DB_URL`): state lives in the `plandesk-data` volume (`/data` in the container). Back up the volume.
- **Remote DB topology** (`PLANDESK_DB_URL` set): state lives in your database. Back that up. The volume then only holds `plandesk.server.json`.

## Environment variables

Every variable the server reads is listed, with a comment, in [`.env.example`](https://github.com/asyncdotengineering/plandesk/blob/main/.env.example).

| Variable                                                  | Default              | Purpose                                                   |
| --------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `PLANDESK_DB_URL`                                         | (unset → local file) | libSQL/Turso URL for the server's database                |
| `PLANDESK_DB_TOKEN`                                       | (unset)              | Auth token for a remote libSQL DB (**secret**)            |
| `PLANDESK_AUTH_PASSWORD`                                  | (unset)              | HTTP basic-auth password (**secret**)                     |
| `PLANDESK_BETTER_AUTH_SECRET`                             | (generated on /data) | Signs sessions and API keys; required with a remote DB    |
| `PLANDESK_BASE_URL`                                       | `http://127.0.0.1:…` | Public URL (sign-in callbacks, share links)               |
| `PLANDESK_HOST_PORT`                                      | `7526`               | Host port compose publishes on (compose only)             |
| `PLANDESK_STORAGE`                                        | `db`                 | `db` (blobs in DB) or `s3`                                |
| `PLANDESK_S3_*`                                           | (unset)              | S3 credentials when `PLANDESK_STORAGE=s3`                 |
| `PLANDESK_GITHUB_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL` | (unset)              | GitHub OAuth (all-or-nothing; omit for no GitHub sign-in) |

## Next

- [Deployment topologies](./topologies/) — local vs self-host vs free-hosted, and who runs migrations.
- [Server configuration](./server-config/) — the full `plandesk.server.json` reference.
- [Cloudflare Workers](./cloudflare/) — edge alternative (Turso + better-auth + R2).
- [Collaboration & sharing](/reference/collaboration/) — guest portal and moderated submissions on the **same** API (no separate sync-server).
