---
title: Cloudflare Workers
description: Deploy Plan Desk to Cloudflare Workers from the repository root — Turso for the database, R2 for files, one button or one command.
---

The repository root is a Worker project: `wrangler.jsonc` points at `packages/plandesk-server/src/worker.ts` (`@plandesk/server`, the hosted composition of the API and MCP) and serves the built web app from `apps/plandesk-web/dist`. `/api/*` and `/mcp/*` reach the Worker; every other path is the web app.

## What you need

- A [Turso](https://turso.tech) (or other libSQL) database URL and auth token. Workers cannot use a local file.
- A secret for `PLANDESK_BETTER_AUTH_SECRET`: `openssl rand -hex 32`. Keep it stable; changing it signs everyone out and invalidates API keys.
- A Cloudflare account.

## Option 1: the Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/asyncdotengineering/plandesk)

The button forks the repository, creates the `plandesk-files` R2 bucket, and asks for `PLANDESK_DB_URL`, `PLANDESK_DB_TOKEN` and `PLANDESK_BETTER_AUTH_SECRET`. `PLANDESK_AUTH_PASSWORD` is optional.

## Option 2: from a clone

```bash
git clone https://github.com/asyncdotengineering/plandesk && cd plandesk
pnpm install
pnpm exec wrangler login
pnpm exec wrangler r2 bucket create plandesk-files     # skip if it exists
pnpm exec wrangler secret put PLANDESK_DB_URL
pnpm exec wrangler secret put PLANDESK_DB_TOKEN
pnpm exec wrangler secret put PLANDESK_BETTER_AUTH_SECRET
pnpm run deploy                                         # builds the web app and server, then wrangler deploy
```

`.dev.vars.example` lists the same secrets; copy it to `.dev.vars` for `pnpm exec wrangler dev`.

## First request

There is no migrate step. The first request prepares the database (migrations, auth tables, backfills) under a lease, so concurrent isolates never race. An isolate that finds another one mid-migration answers `503 schema_behind` for up to a few seconds instead of holding the request; the next request retries. Details: [The server prepares its own database](/self-hosting/topologies/#the-server-prepares-its-own-database).

```bash
curl -s https://plandesk.<your-subdomain>.workers.dev/api/v1/health
```

A missing or malformed secret answers `500 {"error":"misconfigured"}` naming the variable.

## Files: R2 or S3

The `FILES` R2 binding in `wrangler.jsonc` stores uploads and needs no keys. When it is present it wins over any `PLANDESK_STORAGE`/`PLANDESK_S3_*` setting. Remove the binding only if you want files in the database (`PLANDESK_STORAGE` unset) or in another S3-compatible store (`PLANDESK_STORAGE=s3` plus `PLANDESK_S3_*` secrets).

Switching storage later does not move existing files: they stay in the old backend and stop resolving. See [Storage](/self-hosting/server-config/#storage).

## Custom domain

Add the domain to the Worker (Cloudflare dashboard → Workers → your Worker → Domains & Routes), then set the public origin:

```bash
pnpm exec wrangler secret put PLANDESK_BASE_URL       # https://plan.example.com
```

Without it the Worker takes its base URL from the first request each isolate sees, which may be the `workers.dev` host. A secret survives redeploys; `vars` in `wrangler.jsonc` would also work but edits a tracked file.

## Optional settings

All are `wrangler secret put <NAME>`; the full list is in [Server configuration](/self-hosting/server-config/#environment-variables).

- `PLANDESK_AUTH_PASSWORD`: HTTP Basic in front of the whole board.
- GitHub sign-in: `PLANDESK_GITHUB_CLIENT_ID`, `PLANDESK_GITHUB_CLIENT_SECRET`, `PLANDESK_GITHUB_CALLBACK_URL` (all three). Register the OAuth app's callback as `<PLANDESK_BASE_URL>/api/auth/callback/github`.

## After deploy

Mint the first owner and connect a repo: [Self-host Plan Desk for your team](/guides/self-host-for-teams/).

Agent-runnable version of this page: `plandesk deploy cloudflare`.
