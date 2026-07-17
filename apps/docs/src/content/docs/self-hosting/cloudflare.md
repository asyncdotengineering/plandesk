---
title: Cloudflare Workers
description: Deploy the Plan Desk API + SPA on Cloudflare Workers with Turso, R2, and better-auth (GitHub social + paste-token CLI).
---

This is the **edge self-host** path: the same open-source server as Docker/`plandesk serve`, packaged for Cloudflare Workers. You own the database (Turso/libSQL); the Worker never auto-migrates. Auth is **better-auth** — browser sign-in via optional GitHub social, CLI/agent via paste-a-token (`plandesk login`).

:::tip[When to use this]
Pick Workers when you want a public HTTPS API + SPA without running a long-lived VM. For a single-box LAN deploy, prefer [Docker](./docker/) instead.
:::

## Prerequisites

- A [Turso](https://turso.tech/) (or other libSQL) database and auth token
- Cloudflare account + [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler` or use the package-local binary)
- Optional: a GitHub OAuth App if you want dashboard “Sign in with GitHub”
- An R2 bucket for file blobs (or S3-compatible credentials pointing at R2)

## 1. Provision the database and migrate

You own the schema. Apply domain migrations **and** better-auth tables once (and again on upgrades):

```bash
plandesk migrate \
  --db "libsql://your-db.turso.io" \
  --db-token "<token>"
```

The Worker **does not** run migrations at request time. Skipping this step means empty/missing tables and opaque runtime failures.

## 2. GitHub OAuth app (optional)

GitHub is optional ([REQ-20](./topologies/)). Without it, the dashboard uses token entry only; CLI still uses `plandesk login` paste-a-token.

If you want social sign-in:

1. Create a GitHub OAuth App.
2. Set the **Authorization callback URL** to:

   ```text
   <PLANDESK_BASE_URL>/api/auth/callback/github
   ```

   Example: `https://plandesk-api.your-subdomain.workers.dev/api/auth/callback/github`

   This is **better-auth’s** callback route. Do **not** use the removed path `/api/v1/auth/github/callback`.
3. Note the client id and client secret for Wrangler secrets below.

## 3. Configure secrets and public URL

From `packages/plandesk-api` (or your deploy checkout that contains `wrangler.toml`):

```bash
# Database
wrangler secret put PLANDESK_DB_URL
wrangler secret put PLANDESK_DB_TOKEN

# better-auth (required on Workers — non-loopback bind has no default-org trust)
wrangler secret put PLANDESK_BETTER_AUTH_SECRET   # long random string; keep stable across deploys

# Object storage (R2 via S3-compatible API)
wrangler secret put PLANDESK_S3_BUCKET
wrangler secret put PLANDESK_S3_REGION
wrangler secret put PLANDESK_S3_ACCESS_KEY_ID
wrangler secret put PLANDESK_S3_SECRET_ACCESS_KEY
# optional:
# wrangler secret put PLANDESK_S3_ENDPOINT
# wrangler secret put PLANDESK_AUTH_PASSWORD

# Optional GitHub social (all-or-nothing)
wrangler secret put PLANDESK_GITHUB_CLIENT_ID
wrangler secret put PLANDESK_GITHUB_CLIENT_SECRET
# Still required by githubConfigFromEnv for githubEnabled; set to the better-auth callback:
wrangler secret put PLANDESK_GITHUB_CALLBACK_URL
# value: https://<your-worker>/api/auth/callback/github
```

Set the public origin (not a secret) in `wrangler.toml` `[vars]`:

```toml
[vars]
PLANDESK_BASE_URL = "https://plandesk-api.your-subdomain.workers.dev"
```

`PLANDESK_BASE_URL` is better-auth’s `baseURL` (OAuth redirect + cookies). If unset, the Worker falls back to the request URL origin — set it explicitly for stable OAuth.

**Misconfiguration:** without `PLANDESK_BETTER_AUTH_SECRET`, API requests return **500** with a clear `misconfigured` message naming the secret — not a silent 401 storm.

## 4. Build the web SPA into the package

Wrangler serves the SPA from `packages/plandesk-api/web` (`[assets]` in `wrangler.toml`). Build the web app and copy it there (the package `prepack` script does this when publishing; for a local deploy):

```bash
# 1. Build the SPA (outputs to apps/plandesk-web/dist)
pnpm --filter plandesk-web build

# 2. Copy it into the API package's web/ (wrangler [assets] serves it)
pnpm --filter @plandesk/api run prepack
```

The `prepack` step copies `apps/plandesk-web/dist` → `packages/plandesk-api/web`. Confirm `packages/plandesk-api/web/index.html` exists before deploying.

## 5. Deploy

```bash
cd packages/plandesk-api
wrangler deploy
```

Open `PLANDESK_BASE_URL`. Sign in with GitHub (if configured) or mint a CLI token from a signed-in dashboard session and run:

```bash
plandesk login --server "$PLANDESK_BASE_URL"
plandesk connect --to <org> [--project <id|name>]
```

Agents never log in themselves — humans paste tokens; `connect` writes a scoped agent key into `.plandesk/token`. Full grammar: [CLI Reference](/reference/cli/#hosted-login-and-connect-two-actor).

## Checklist

| Step | Done when |
| --- | --- |
| Turso + `plandesk migrate` | Domain + better-auth tables exist |
| GitHub callback | `{baseURL}/api/auth/callback/github` |
| Secrets | DB, `PLANDESK_BETTER_AUTH_SECRET`, S3/R2, optional GitHub |
| Vars | `PLANDESK_BASE_URL` public origin |
| SPA | `web/` next to `wrangler.toml` |
| Deploy | `wrangler deploy` succeeds; `/api/v1/health` is 200 |

## Related

- [Deployment topologies](./topologies/) — local vs self-host vs free-hosted; who migrates
- [Server configuration](./server-config/) — env/file knobs for Node/`plandesk serve`
- [Docker (self-host)](./docker/) — long-running container alternative
