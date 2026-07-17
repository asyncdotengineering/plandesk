---
title: Deployment topologies
description: The three ways to run Plan Desk — local single-project (default), self-host, and free-hosted — and who runs database migrations in each.
---

Plan Desk is **local-first** by default and **cloud-optional** everywhere. There are three ways to run it, and the difference is entirely about **who owns the database**. Pick the one that matches your trust and operational appetite.

:::tip[Cloud is opt-in — REQ-9]
No login, no `syncUrl`, no account → the tool stays **entirely on your machine**. Nothing leaves your device unless you explicitly connect a hosted server. This is the product's core promise; the cloud is an addition, never a requirement.
:::

## The three topologies

### 1. Local single-project — the default

**What it is.** You install the CLI from npm, run `plandesk init && plandesk serve`, and work against a SQLite file on your own disk. No account, no network, no server you don't control.

**When to pick it.** For yourself and your coding agent on one machine. This is what 95% of users want and what every guide starts from.

**How to run it.**

```bash
npm i -g @plandesk/cli
plandesk init && plandesk serve          # UI at http://127.0.0.1:3847
```

**Migrations.** The schema is migrated **automatically at `serve` boot**. You never run a migration command — `serve` checks and applies them to your local file.

### 2. Self-host — your server, your database

**What it is.** You run the Plan Desk server (the same binary) on a host you control — a VM, a Docker host, a NAS — pointed at **your own database**. No dependency on asyncdot infrastructure. No GitHub app required ([REQ-20](#)).

**When to pick it.** A small team that wants a shared, always-on planning server behind their own firewall/TLS, with data in a database they back up — without depending on a vendor's hosted instance.

**How to run it.** The fastest path is the server container + compose quickstart:

```bash
export PLANDESK_AUTH_PASSWORD='choose-a-strong-password'
docker compose -f docker-compose.hosted.yml up --build
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). For a durable database, point `PLANDESK_DB_URL` at your own libSQL/Turso database — see [Docker (self-host)](./docker/) and [Server configuration](./server-config/).

**Migrations.** *You* own the database, so *you* run migrations:

```bash
plandesk migrate --db "libsql://your-db.example" --db-token "<token>"
```

The server does **not** auto-migrate a remote database — that's a deliberate choice so a multi-replica deploy never races on the schema. Run it once per database, whenever you upgrade. See [the operator migration story](#who-runs-migrations) below.

If the same database is also served by Workers or Vercel, use the same value for `PLANDESK_BETTER_AUTH_SECRET` in every topology (`plandesk serve` accepts `PLANDESK_SESSION_SECRET` as a legacy alias).

### 3. Free-hosted — the asyncdot instance

**What it is.** asyncdot runs the server for you at `plandesk.asyncdot.com`. You sign in (GitHub) and use the hosted web app + MCP endpoint. No install, no database to manage.

**When to pick it.** You want zero setup and are fine with the data living on the hosted instance. Ideal for trying Plan Desk or for users who never want to touch a terminal.

**How to run it.** Open the hosted app and connect your agent to the hosted MCP URL. (The hosted tier is the asyncdot-operated instance of this same open-source server.)

**Connect a CLI/agent.** Hosted auth is paste-based and two-actor: a human generates a CLI token in the dashboard, runs `plandesk login` and pastes it, then `plandesk connect --to <org> [--project <id|name>]` mints a scoped agent key into `.plandesk/token`. Agents never log in. Same flow against a self-hosted API with `plandesk login --server <url>`. Full grammar: [CLI Reference](/reference/cli/#hosted-login-and-connect-two-actor).

**Migrations.** **You never migrate, and you never receive a database URL.** The provider (asyncdot) runs migrations in CI against their own secret database URL. As a cloud user, your only surface is the API — you never touch the schema.

## Who runs migrations

Migrations are keyed to **who owns the database**, not to which client you use:

| Topology | Database owner | Who migrates | How |
| --- | --- | --- | --- |
| Local single-project | You (local file) | The tool | Automatically, at `serve` boot |
| Self-host | You (your DB) | **You, the operator** | `plandesk migrate --db <your-url>` after each upgrade |
| Free-hosted | The provider | The provider, in CI | Against their own secret URL — invisible to you |

:::caution[A cloud user never migrates]
On the free-hosted topology there is **no** `plandesk migrate`, **no** database URL, and **no** schema access. If you are ever asked to run a migration against a URL while using the hosted instance, something is wrong — stop and report it.
:::

## How cloud stays opt-in

The local tool has no phone-home. Specifically:

- **No account needed.** `plandesk init && plandesk serve` works offline, forever.
- **No `syncUrl` until you set one.** Sync/share only activates when you explicitly run `plandesk deploy …` and `plandesk share create …` against a server URL you chose.
- **No telemetry.** The CLI does not send usage data anywhere.

The hosted instance is one *option* for running the same open-source server — not a dependency of the local tool.

## Next

- [Server configuration](./server-config/) — the `plandesk.server.json` file, env overrides, and `plandesk doctor`.
- [Docker (self-host)](./docker/) — the `Dockerfile.server` / `docker-compose.hosted.yml` quickstart.
- [Cloudflare Workers](./cloudflare/) — edge deploy (Turso + better-auth + R2); operator runs `plandesk migrate`.
- [Collaboration & sync](/reference/collaboration/) — the optional hosted sync tier architecture.
