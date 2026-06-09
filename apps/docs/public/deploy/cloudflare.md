---
target: cloudflare
store: d1
website: https://developers.cloudflare.com
summary: Deploy the Plan Desk sync server to Cloudflare Workers + D1 and the client portal to Cloudflare Pages.
---

# Deploy Plan Desk to Cloudflare (Workers + D1 + Pages)

You are an AI coding agent deploying Plan Desk's **hosted sync tier** to the user's own Cloudflare account. The user ran `plandesk deploy cloudflare | <you>`. Follow these instructions exactly; confirm with the user only when something is genuinely ambiguous (e.g. an unusual repo layout, or a database that already exists). Your job: stand up the sync server, wire the local project to it, and produce a shareable client-portal link.

This is the rendezvous tier only — it holds the curated projections the owner pushes, never the local source of truth. Read [the collaboration architecture](https://plandesk.asyncdot.com/reference/collaboration/) if you need the model.

Work from the **repo root**. Run steps in order. Do not skip the verification step.

## Read this before you touch anything — secrets are non-negotiable

The sync server authenticates the owner with a **sync token**. It is the one secret this deploy mints. Handle it exactly like this, or you leak the owner's write access to their hosted tier:

- The token's plaintext is written **only** to `.plandesk/sync-token`, which **must** be gitignored.
- **Only its sha256 hash** is stored in D1 (`sync_tokens.token_hash`).
- **Never** print the plaintext token to stdout, echo it, write it into `config.json`, pass it on a command line, or commit it.
- If any step would surface the plaintext, stop and fix the step.

The D1 `database_id` in `wrangler.toml` is **not** a secret — it is committed, standard Cloudflare practice.

## Prerequisites — check, don't assume

```bash
wrangler --version          # if missing: npm i -g wrangler  (or: npx wrangler ...)
wrangler whoami             # must show the human's account; if not: tell them to run `wrangler login` themselves
node --version              # Node is already a repo dependency; you need it for the token mint step
pnpm --version
```

If `wrangler whoami` is unauthenticated, **stop** and ask the human to run `wrangler login` in their terminal — it is an interactive OAuth flow you cannot complete for them. Build the repo so the worker bundle and the portal are ready:

```bash
pnpm install
pnpm build
```

## Step 1 — Provision the D1 database (idempotent)

Check first; D1 creation is billable and non-idempotent:

```bash
wrangler d1 list
```

If a database named `plandesk-sync` already exists, take its `database_id` from that output and skip the create. Otherwise:

```bash
wrangler d1 create plandesk-sync
```

Copy the `database_id` it prints. Write it into `packages/plandesk-sync-server/wrangler.toml` under `[[d1_databases]]` → `database_id`. (The binding `DB`, name `plandesk-sync`, `compatibility_flags = ["nodejs_compat"]`, and `main = "src/worker.ts"` are already set — leave them.)

## Step 2 — Apply the schema to remote D1 (idempotent)

```bash
wrangler d1 execute plandesk-sync --remote \
  --file packages/plandesk-sync-server/migrations/0001_init.sql
```

The migration uses `CREATE TABLE` (not `IF NOT EXISTS`); if it errors because the tables already exist from a prior run, that is fine — the schema is present. Confirm:

```bash
wrangler d1 execute plandesk-sync --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

You should see `sync_tokens`, `hosted_shares`, `participants`, `activity_log`, `submissions`, `projection_blobs`.

## Step 3 — Deploy the Worker

```bash
cd packages/plandesk-sync-server
wrangler deploy
cd ../..
```

Capture the deployed URL it prints — e.g. `https://plandesk-sync-server.<subdomain>.workers.dev`. Call this **`SYNC_URL`** from here on. Sanity check (an unauthenticated portal endpoint for a non-existent share should answer, not hang):

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$SYNC_URL/api/portal/v1/shares/nope/meta"   # expect 404, not a timeout
```

## Step 4 — Mint the owner sync token (sha256 at rest, plaintext gitignored)

Ensure the token is gitignored, then mint it. This one-liner writes the **plaintext to `.plandesk/sync-token` only** and prints **just the row id + hash** for the INSERT — never the plaintext:

```bash
mkdir -p .plandesk
grep -qxF '.plandesk/sync-token' .gitignore || printf '.plandesk/sync-token\n' >> .gitignore

node -e '
const c = require("node:crypto"), fs = require("node:fs");
const id = c.randomUUID();
const token = "plandesk_sync_" + c.randomBytes(32).toString("base64url");
const hash = c.createHash("sha256").update(token).digest("hex");
fs.writeFileSync(".plandesk/sync-token", token, { mode: 0o600 });
process.stdout.write(id + " " + hash + "\n");   // id + hash only — never the token
'
```

Take the printed `id` and `hash` and store **only the hash** in D1:

```bash
wrangler d1 execute plandesk-sync --remote \
  --command "INSERT INTO sync_tokens (id, token_hash, label) VALUES ('<id>', '<hash>', 'owner');"
```

The token format and hashing here match the server's own `createSyncToken` (`plandesk_sync_<base64url>`, sha256-hex), so the worker will authenticate this token. Do **not** read `.plandesk/sync-token` back out to stdout to "verify" it.

## Step 5 — Build + deploy the client portal (Cloudflare Pages)

The portal is the same web app in read-only mode. It resolves its sync server from the build-time `VITE_SYNC_URL`, and it client-side-routes `/p/:shareToken`. The SPA fallback (`public/_redirects`) is already in source, so a plain build emits it — build the portal against `SYNC_URL`:

```bash
VITE_SYNC_URL="$SYNC_URL" pnpm --filter plandesk-web build
test -f apps/plandesk-web/dist/_redirects   # SPA fallback for deep links like /p/<token>; ships from source
```

Create the Pages project once (ignore "already exists"), then deploy:

```bash
wrangler pages project create plandesk-portal --production-branch main || true
wrangler pages deploy apps/plandesk-web/dist --project-name plandesk-portal
```

Capture the Pages URL it prints — e.g. `https://plandesk-portal.pages.dev`. Call it **`PORTAL_URL`**.

## Step 6 — Wire the local project to the hosted tier

The local project must be `plandesk connect`-ed already (it needs `.plandesk/config.json` with a `projectId`). Register it with the remote — `publish` reads the sync token from `.plandesk/sync-token` and uses the connected project, so `--project` is optional:

```bash
plandesk publish --remote "$SYNC_URL"
```

This writes the `sync: { serverUrl, globalProjectId }` block into `.plandesk/config.json` (no token in there) and registers the global project on the worker.

## Step 7 — Create a share, then push and verify end-to-end

Create a named share for this audience. The command prints a `plandesk_share_…` token **once** (only its sha256 hash is stored), plus the link template. Use `--public` for an open named-join, or omit it and pass `--invite <email>` for invite-only; add `--allow-submit` to let the audience file issues, and `--expires 30d` to time-box it:

```bash
plandesk share create --audience "Demo client" --public --allow-submit
```

Take the printed token (`plandesk_share_…`). Then push its projection to the worker:

```bash
plandesk push                    # PUTs the allow-list ClientView for each active share to the worker
```

The shareable link is **`$PORTAL_URL/p/<shareToken>`** (substitute the Pages URL from Step 5 for `<your-portal-url>` in the command's output). Verify the hosted path with curl before handing it over:

```bash
# meta resolves
curl -s "$SYNC_URL/api/portal/v1/shares/<shareToken>/meta" | jq .

# join (named) → returns a participant session bearer
curl -s -X POST "$SYNC_URL/api/portal/v1/shares/<shareToken>/join" \
  -H 'content-type: application/json' -d '{"name":"Smoke Test"}'

# view with that session bearer → projection, and it must NOT contain internal entities
curl -s "$SYNC_URL/api/portal/v1/shares/<shareToken>/view" \
  -H "authorization: Bearer <participant-session>" | jq 'has("agent_runs") | not'   # => true
```

Then open `$PORTAL_URL/p/<shareToken>` in a browser: the named-join gate, then the read-only board/canvas. Set a task to in-progress locally (or run `plandesk sync --watch`) and confirm the portal updates within a few seconds over SSE.

## Report back to the human

Tell them, plainly:

- **Sync server:** `$SYNC_URL` (Cloudflare Workers + D1 `plandesk-sync`).
- **Portal:** `$PORTAL_URL`.
- **Share link:** `$PORTAL_URL/p/<shareToken>` — read-only, named-join.
- The owner sync token lives in `.plandesk/sync-token` (gitignored); only its hash is in D1. Don't commit it.
- `wrangler.toml` now carries the committed D1 `database_id`.
- Live updates: run `plandesk sync --watch` to push local changes to the portal automatically.

If any step failed, report which one and the exact error — do not paper over a half-applied deploy.
