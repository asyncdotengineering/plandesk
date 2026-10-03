---
target: cloudflare
store: Workers + Turso + R2
website: https://developers.cloudflare.com/workers/
summary: Deploy the Plan Desk board, REST API and MCP to Cloudflare Workers from the repository root, with Turso for the database and R2 for files.
---

# Deploy Plan Desk to Cloudflare Workers

You are an AI coding agent deploying Plan Desk to the user's Cloudflare account. The user ran `plandesk deploy cloudflare | <you>`. Follow these steps in order and verify each one. Stop and report the exact error if a step fails; do not paper over a half-working deploy.

What gets deployed: one Worker (`wrangler.jsonc` at the repository root, entry `packages/plandesk-server/src/worker.ts`) that serves the web app from static assets and `/api/*` and `/mcp/*` from code. The database is libSQL/Turso. Uploaded files go to the R2 bucket `plandesk-files` (binding `FILES`). The Worker migrates its own database on the first request; there is no migrate step.

Rules for secrets: never print a secret, a token or the contents of `.dev.vars` to the terminal or your transcript. `.dev.vars` is git-ignored; never commit it.

## Step 1: Repository checkout

Work from the root of a Plan Desk checkout. Check:

```bash
test -f wrangler.jsonc && grep -q plandesk-server wrangler.jsonc && echo OK
```

If that does not print `OK`, clone and enter it:

```bash
git clone https://github.com/asyncdotengineering/plandesk && cd plandesk
```

## Step 2: Tools and Cloudflare login

```bash
node --version            # 20 or newer
corepack enable && pnpm --version
pnpm install --frozen-lockfile
pnpm exec wrangler whoami
```

If `wrangler whoami` says you are not logged in, ask the human to run `pnpm exec wrangler login` and wait for them.

## Step 3: A libSQL/Turso database and the secrets file

Plan Desk on Workers needs a remote libSQL database. Ask the human which applies:

- **They have a database URL and token.** Ask them to create `.dev.vars` at the repository root with two lines, `PLANDESK_DB_URL=<url>` and `PLANDESK_DB_TOKEN=<token>`, so the values never pass through you. Then add the auth secret:

  ```bash
  echo "PLANDESK_BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .dev.vars
  ```

- **They use the Turso CLI and want a new database.** Check `turso auth whoami`; if it fails, ask the human to run `turso auth login`. Then:

  ```bash
  turso db create plandesk           # skip if `turso db list` already shows it
  {
    echo "PLANDESK_DB_URL=$(turso db show plandesk --url)"
    echo "PLANDESK_DB_TOKEN=$(turso db tokens create plandesk)"
    echo "PLANDESK_BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
  } > .dev.vars
  ```

Confirm the three names are set without printing values:

```bash
for n in PLANDESK_DB_URL PLANDESK_DB_TOKEN PLANDESK_BETTER_AUTH_SECRET; do
  grep -q "^$n=." .dev.vars && echo "$n set" || echo "$n MISSING"
done
```

Optional lines in `.dev.vars` (ask the human; see https://plandesk.asyncdot.com/self-hosting/server-config/ for all of them):

- `PLANDESK_AUTH_PASSWORD=<password>`: HTTP Basic in front of the whole board.
- `PLANDESK_BASE_URL=https://<custom-domain>`: required if the board will have a custom domain (Step 7).
- `PLANDESK_GITHUB_CLIENT_ID`, `PLANDESK_GITHUB_CLIENT_SECRET`, `PLANDESK_GITHUB_CALLBACK_URL`: GitHub sign-in, all three or none.

Do not set `PLANDESK_STORAGE` or `PLANDESK_S3_*`: the R2 binding stores files.

## Step 4: The R2 bucket

```bash
pnpm exec wrangler r2 bucket list | grep -q plandesk-files \
  || pnpm exec wrangler r2 bucket create plandesk-files
```

## Step 5: Build and deploy

```bash
pnpm run build:cloudflare
pnpm exec wrangler deploy --secrets-file .dev.vars
```

Record the URL wrangler prints as **WORKER_URL**, e.g. `https://plandesk.<subdomain>.workers.dev`.

## Step 6: Verify

The first request prepares the database. While another isolate holds the migration lease it answers `503 {"error":"schema_behind"}`; retry for up to a minute:

```bash
for i in $(seq 1 30); do
  body=$(curl -s "$WORKER_URL/api/v1/health")
  echo "$body" | grep -q '"current":true' && { echo "healthy"; break; }
  sleep 2
done
echo "$body"
```

- `"current":true` in the `schema` object: done.
- `{"error":"misconfigured","message":...}`: a secret is missing or malformed; the message names it. Fix `.dev.vars` and repeat Step 5.
- `schema_behind` after a minute: report the body; another deployment of a newer version may own this database.

Also check that the web app loads: `curl -s -o /dev/null -w '%{http_code}\n' "$WORKER_URL/"` prints `200`.

## Step 7: Custom domain (only if the human wants one)

Ask the human to attach the domain in the Cloudflare dashboard (Workers → `plandesk` → Domains & Routes). Then set the origin and redeploy:

```bash
echo "PLANDESK_BASE_URL=https://<custom-domain>" >> .dev.vars
pnpm exec wrangler deploy --secrets-file .dev.vars
```

Without `PLANDESK_BASE_URL`, sign-in cookies follow whichever host an isolate saw first. If GitHub sign-in is configured, the OAuth app's callback must be `https://<custom-domain>/api/auth/callback/github`.

## Step 8: The first owner

Mint the first owner invitation with the user's installed `plandesk` CLI, reading the values from `.dev.vars` without printing them:

```bash
( set -a; . ./.dev.vars; set +a
  plandesk admin invite-owner --email "<owner email>" \
    --db "$PLANDESK_DB_URL" --db-token "$PLANDESK_DB_TOKEN" --secret "$PLANDESK_BETTER_AUTH_SECRET" )
```

It prints a claim link. If the link starts with `http://127.0.0.1`, replace that origin with WORKER_URL (or the custom domain). Give the link to the human; it is a credential, so do not paste it anywhere else.

## Report back

- **Board:** WORKER_URL (and the custom domain, if set). MCP is at `<url>/mcp`.
- **Health:** the `schema` line from Step 6.
- **Claim link:** delivered to the human.
- **Secrets:** in `.dev.vars` (git-ignored) and in the Worker. Tell the human to store `PLANDESK_BETTER_AUTH_SECRET` somewhere safe; changing it signs everyone out and invalidates API keys.
- **Next for the human:** claim ownership, then `plandesk login --server <url>` and `plandesk connect --to <org-id>` in each repo.
