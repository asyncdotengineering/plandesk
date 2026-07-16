---
target: cloudflare
store: d1
website: https://developers.cloudflare.com
summary: Deploy the Plan Desk API to Cloudflare Workers + D1 and the portal SPA to Pages.
---

# Deploy Plan Desk to Cloudflare (Workers + D1 + Pages)

You are an AI coding agent deploying Plan Desk's **single hosted API** to the user's Cloudflare account. The user ran `plandesk deploy cloudflare | <you>`. Follow these instructions exactly.

There is **no `@plandesk/sync-server` package**. Portal join/view/submissions live on `@plandesk/api` (Worker entry in `packages/plandesk-api`). See [collaboration](https://plandesk.asyncdot.com/reference/collaboration/).

Work from the **repo root of a Plan Desk source checkout**. If the user only has the global CLI, clone the repo at the matching tag first.

## Prerequisites

```bash
wrangler --version
wrangler whoami             # if not authed: ask human to `wrangler login`
pnpm --version
pnpm install && pnpm build
```

## Step 1 — D1 database

```bash
wrangler d1 list
# if missing: wrangler d1 create plandesk
```

Wire `database_id` into `packages/plandesk-api` wrangler config (or the project's Workers config for the API). Apply migrations with the API package's migrate path / `plandesk migrate` against D1 as documented for that package version.

## Step 2 — Deploy the API Worker

Deploy from `packages/plandesk-api` (or monorepo Worker entry that serves `@plandesk/api`). Capture **API_URL** (e.g. `https://plandesk-api.<subdomain>.workers.dev`).

Sanity check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$API_URL/api/v1/share/nope/meta"   # expect 404
```

## Step 3 — Wire project and share

```bash
plandesk login --server "$API_URL"
plandesk push --to <org-id>
plandesk share create --audience "Demo client" --public --allow-submit
```

## Step 4 — Portal SPA (optional static host)

If the Worker does not serve the SPA, build web against this API origin:

```bash
# same-origin preferred; only set VITE_API_URL when the SPA is on a different host
VITE_API_URL="$API_URL" pnpm --filter plandesk-web build
# deploy apps/plandesk-web/dist to Pages (SPA fallback for /p/*)
```

Share link: `<portal-or-api-url>/p/<shareToken>`.

## Step 5 — Verify

```bash
curl -s "$API_URL/api/v1/share/<shareToken>/meta" | jq .
curl -s -X POST "$API_URL/api/v1/share/<shareToken>/join" \
  -H 'content-type: application/json' -d '{"name":"Smoke"}'
```

## Report back

- **API:** `$API_URL`
- **Share:** `<url>/p/<shareToken>`
- No separate sync Worker; no `VITE_SYNC_URL`
