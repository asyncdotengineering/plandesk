---
title: Deployment topologies
description: Local or self-hosted on Docker, Cloudflare Workers or Vercel — what each needs, and how every target prepares its own database.
---

Plan Desk is **local-first**. Running it somewhere else is opt-in, and every option runs the same open-source server.

:::tip[Cloud is opt-in]
No login, no server URL, no account: the tool stays entirely on your machine. Nothing leaves your device unless you connect it to a server you chose. The CLI sends no telemetry.
:::

## Local — the default

```bash
npm i -g @plandesk/cli
plandesk init && plandesk serve          # UI at http://127.0.0.1:7526
```

A SQLite file on your disk, bound to loopback, no account. This is what most people want: you and your coding agent on one machine.

## Self-hosted — your server, your database

One board for a team, on infrastructure you own. Pick a target:

| Target                                          | Runs as                              | Database                            | Files                      | Pick it when                                     |
| ----------------------------------------------- | ------------------------------------ | ----------------------------------- | -------------------------- | ------------------------------------------------ |
| [Docker](/self-hosting/docker/)                 | `plandesk serve` in a container      | SQLite on a volume, or libSQL/Turso | database or S3             | You have a box (VM, NAS, home server).           |
| [Cloudflare Workers](/self-hosting/cloudflare/) | a Worker plus static assets          | libSQL/Turso (required)             | R2 binding, database or S3 | You want public HTTPS without running a machine. |
| [Vercel](/self-hosting/vercel/)                 | a Vercel function plus static output | libSQL/Turso (required)             | database or S3             | Your team already deploys to Vercel.             |

Each serves the web app, the REST API and MCP at `/mcp`. Settings are the same environment variables everywhere: see [Server configuration](/self-hosting/server-config/). GitHub sign-in is optional on every target.

No managed instance is offered today. One may be offered later; until then, the docs site is only documentation.

## The server prepares its own database

There is no separate migrate step. Before serving, every target brings its database up to date: domain migrations, the better-auth tables and the workspace backfills. This works the same for a SQLite file and for a remote libSQL/Turso database, and it is what makes the Deploy buttons one-click.

**Only one instance migrates at a time.** Preparation runs under a lease: one row in a `__plandesk_lease` table, taken with a single compare-and-set write that only succeeds when no lease exists or the current one has expired.

- The lease lasts **60 seconds**, and the holder renews it every 20 seconds while it works. A holder that crashes stops renewing, and its lease expires.
- A database that is already current costs reads only: no lease, no write.
- Instances that find the lease taken wait for it. `plandesk serve` (and so Docker) waits up to **90 seconds**, longer than a lease, so it outlives a crashed holder. Workers and Vercel wait 2 seconds, so a request is never held open.
- An instance that gives up answers every request with **`503 {"error":"schema_behind","schema":{…}}`**, where `schema` is the migration summary (`applied`, `shipped`, `current`, `missingTags`). It keeps retrying: `plandesk serve` every 2 seconds, Workers and Vercel on the next request. Once the schema is current it serves normally.

`GET /api/v1/health` reports the same `schema` summary, so a load balancer or uptime check can tell a stale schema from a down server.

### `plandesk migrate` in CI (optional)

If you would rather migrate before traffic arrives, run the same preparation from CI, under the same lease:

```bash
plandesk migrate --db "$PLANDESK_DB_URL" --db-token "$PLANDESK_DB_TOKEN"
```

It prints the migrations it applied, or that the database is already current. The servers then find a current schema and start straight away.

### Rolling back to an older version

A database migrated by a newer Plan Desk is ahead of an older binary. The older server cannot un-apply migrations, so it answers `503 schema_behind` (with `applied` greater than `shipped`) until you deploy the newer version again. Roll forward rather than back, or restore the database from a backup taken before the upgrade.

### Every boot fails: a project without its organization

Preparation repairs projects whose workspace is missing by putting them in their organization's default workspace. A project row whose organization no longer exists cannot be repaired that way, so preparation fails on every boot and the server never starts serving.

Find such rows. Stop the server first, then open the database with `turso db shell <db>` (Turso) or `sqlite3 <data-dir>/workspace.db` (a local file):

```sql
SELECT p.id, p.name, p.org_id
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM organization o WHERE o.id = p.org_id);
```

Fix each one by moving it into an organization that exists. Preparation then gives it that organization's default workspace on the next boot:

```sql
SELECT id, name FROM organization;                           -- pick the right one
UPDATE projects SET org_id = '<organization-id>' WHERE id = '<project-id>';
```

Take a backup before editing rows by hand.

## Next

- [Server configuration](/self-hosting/server-config/): every variable, storage choices, custom domains.
- [Self-host Plan Desk for your team](/guides/self-host-for-teams/): invite teammates and connect their repos.
- [Collaboration](/reference/collaboration/): sharing a plan with a client from the same server.
