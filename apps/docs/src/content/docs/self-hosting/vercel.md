---
title: Vercel
description: Deploy Plan Desk to Vercel from the repository root — one function for the API and MCP, static output for the web app, Turso for the database.
---

The repository root is a Vercel project. `vercel.json` builds the web app and `@plandesk/server`, serves `apps/plandesk-web/dist` as static output, and rewrites `/api/*` and `/mcp/*` to one function, `api/index.ts`, which runs the hosted composition of the API and MCP.

## What you need

- A [Turso](https://turso.tech) (or other libSQL) database URL and auth token. Functions cannot keep a local file.
- A secret for `PLANDESK_BETTER_AUTH_SECRET`: `openssl rand -hex 32`. Keep it stable; changing it signs everyone out and invalidates API keys.
- A Vercel account.

## Option 1: the Deploy button

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fasyncdotengineering%2Fplandesk&env=PLANDESK_DB_URL,PLANDESK_DB_TOKEN,PLANDESK_BETTER_AUTH_SECRET&envDescription=Turso%2FlibSQL%20database%20URL%20and%20token%2C%20and%20a%20random%20secret%20from%20%60openssl%20rand%20-hex%2032%60.&envLink=https%3A%2F%2Fplandesk.asyncdot.com%2Fself-hosting%2Fserver-config%2F)

The button clones the repository into your account and asks for `PLANDESK_DB_URL`, `PLANDESK_DB_TOKEN` and `PLANDESK_BETTER_AUTH_SECRET`.

## Option 2: from a clone

```bash
git clone https://github.com/asyncdotengineering/plandesk && cd plandesk
npx vercel link
npx vercel env add PLANDESK_DB_URL production
npx vercel env add PLANDESK_DB_TOKEN production
npx vercel env add PLANDESK_BETTER_AUTH_SECRET production
npx vercel deploy --prod
```

Leave the project's framework, build command and output directory to `vercel.json`.

## First request

There is no migrate step. The first request prepares the database (migrations, auth tables, backfills) under a lease, so concurrent function instances never race. An instance that finds another one mid-migration answers `503 schema_behind` for a few seconds instead of holding the request; the next request retries. Details: [The server prepares its own database](/self-hosting/topologies/#the-server-prepares-its-own-database).

```bash
curl -s https://<your-project>.vercel.app/api/v1/health
```

A missing or malformed variable answers `500 {"error":"misconfigured"}` naming it.

## Domains and preview deployments

Without `PLANDESK_BASE_URL`, the function uses the project's production domain (Vercel's `VERCEL_PROJECT_PRODUCTION_URL`), never the per-deployment URL. Add a custom domain in the Vercel dashboard and, to be explicit, set `PLANDESK_BASE_URL=https://plan.example.com` for production.

**Preview deployments cannot sign in.** Their sign-in cookies and callbacks are built for the production domain, not the preview URL. Use previews to check that a build boots (`/api/v1/health`), and sign in on production. Give previews their own database if they should not share production's.

## Files

Vercel has no R2 binding. Files stay in the database by default; for object storage, set `PLANDESK_STORAGE=s3` and the `PLANDESK_S3_*` variables. Cloudflare R2 works through its S3 API: region `auto`, endpoint `https://<account-id>.r2.cloudflarestorage.com`. Choose before the first upload: switching later leaves existing files in the old backend. See [Storage](/self-hosting/server-config/#storage).

## Optional settings

Add them with `npx vercel env add <NAME> production`; the full list is in [Server configuration](/self-hosting/server-config/#environment-variables).

- `PLANDESK_AUTH_PASSWORD`: HTTP Basic in front of the whole board.
- GitHub sign-in: `PLANDESK_GITHUB_CLIENT_ID`, `PLANDESK_GITHUB_CLIENT_SECRET`, `PLANDESK_GITHUB_CALLBACK_URL` (all three). Register the OAuth app's callback as `<PLANDESK_BASE_URL>/api/auth/callback/github`.

Redeploy after changing variables: `npx vercel deploy --prod`.

## After deploy

Mint the first owner and connect a repo: [Self-host Plan Desk for your team](/guides/self-host-for-teams/).

Agent-runnable version of this page: `plandesk deploy vercel`.
