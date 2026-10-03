---
title: Docker
description: Run Plan Desk in a container you build from the repository — compose.yaml, the Dockerfile, and how to secure and back it up.
---

The repository's `Dockerfile` builds `plandesk serve` plus the web app into an image. Nothing is published to a registry: you build it locally, and that image is the one the project tests. It serves the web app, the REST API and MCP at `/mcp` on port **7526**.

## Quickstart (compose)

```bash
git clone https://github.com/asyncdotengineering/plandesk && cd plandesk
cp .env.example .env    # set PLANDESK_AUTH_PASSWORD (required) and PLANDESK_BETTER_AUTH_SECRET
docker compose up --build -d
```

Open [http://127.0.0.1:7526](http://127.0.0.1:7526) and sign in as user `plandesk` with your `PLANDESK_AUTH_PASSWORD`. Set `PLANDESK_HOST_PORT` in `.env` to publish on another host port.

- **Database.** A SQLite file on the `plandesk-data` volume by default. To use libSQL/Turso instead, set `PLANDESK_DB_URL` and `PLANDESK_DB_TOKEN` in `.env`.
- **Migrations.** None to run. The server prepares its database at boot, under a lease so replicas never race; see [The server prepares its own database](/self-hosting/topologies/#the-server-prepares-its-own-database).
- **Secret.** With the file database the server generates `PLANDESK_BETTER_AUTH_SECRET` on the volume if you leave it blank. With a remote database, set it (`openssl rand -hex 32`).
- **Settings.** Every variable is in [Server configuration](/self-hosting/server-config/#environment-variables).

Check it:

```bash
docker compose ps                                   # STATUS shows (healthy)
curl -s http://127.0.0.1:7526/api/v1/health         # public; schema.current is true
docker compose run --rm plandesk doctor             # resolved settings, secrets redacted
```

## Upgrading

```bash
git pull
docker compose up --build -d
```

The new container migrates the database before it serves. Back up first (see below): an older image cannot run on a database a newer one migrated.

## Without compose

```bash
docker build -t plandesk:local .
docker run -d --name plandesk -p 127.0.0.1:7526:7526 -v plandesk-data:/data \
  -e PLANDESK_AUTH_PASSWORD='<password>' \
  -e PLANDESK_BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  plandesk:local
```

The image runs as a non-root user, keeps its data in `/data`, binds `0.0.0.0:7526` inside the container and reports health from `/api/v1/health`. Its entrypoint is the `plandesk` CLI, so `docker run --rm -v plandesk-data:/data plandesk:local doctor` runs any other command.

## A domain and TLS

Put a reverse proxy (Caddy, nginx, Traefik) in front for HTTPS and set `PLANDESK_BASE_URL` in `.env` to the public origin, e.g. `https://plan.example.com`. Sign-in cookies, the GitHub callback and share links are built on it. See [Custom domains](/self-hosting/server-config/#custom-domains).

## Securing the server

### The bind address is the trust boundary

Plan Desk treats a **loopback bind** (`127.0.0.1`, `::1` or `localhost`) as proof that only this machine can reach it. On a loopback bind every request is the org owner, with no login at all. That is what makes a local board zero-setup.

On any other bind address that trust is gone and better-auth does the authenticating.

**So do not run `plandesk serve` on loopback behind a reverse proxy.** The server still believes only this machine can reach it, while the proxy hands the internet an owner session. Nothing errors and nothing in the UI looks wrong; the board simply has no access control.

|                  | Bind        | Who can reach it            | Authentication                            |
| ---------------- | ----------- | --------------------------- | ----------------------------------------- |
| **Local board**  | `127.0.0.1` | this machine only, no proxy | none needed — loopback is the boundary    |
| **Served board** | `0.0.0.0`   | proxy or network            | better-auth, and `PLANDESK_AUTH_PASSWORD` |

The image already does the right thing: it binds `0.0.0.0` inside the container, and compose publishes the port on the host's `127.0.0.1` only. Point your proxy at that port.

### Other controls

- **`PLANDESK_AUTH_PASSWORD`** puts HTTP Basic in front of the UI and REST API. Compose refuses to start without it.
- **GitHub sign-in is optional.** Without it, owners use CLI tokens (`plandesk login`) and invitation links.

## Backups

- **File database** (no `PLANDESK_DB_URL`): everything, including uploaded files in the default `db` storage, is in the `plandesk-data` volume. Back up the volume.
- **Remote database**: back up the database. The volume then holds only an optional `plandesk.server.json`.
- **S3 storage**: back up the bucket as well. Choose storage before the first upload; switching later leaves existing files in the old backend ([Storage](/self-hosting/server-config/#storage)).

## Next

- [Deployment topologies](/self-hosting/topologies/): the lease, `plandesk migrate` in CI, rollbacks.
- [Self-host Plan Desk for your team](/guides/self-host-for-teams/): the first owner, invitations, connecting repos.
- Agent-runnable version of this page: `plandesk deploy docker`.
