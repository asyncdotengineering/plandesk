---
target: vercel
store: Functions + Turso
website: https://vercel.com/docs
summary: Deploy the Plan Desk board, REST API and MCP to Vercel from the repository root, with Turso for the database and files in the database or S3.
---

# Deploy Plan Desk to Vercel

You are an AI coding agent deploying Plan Desk to the user's Vercel account. The user ran `plandesk deploy vercel | <you>`. Follow these steps in order and verify each one. Stop and report the exact error if a step fails; do not paper over a half-working deploy.

What gets deployed: the repository root is the Vercel project. `vercel.json` builds the web app and `@plandesk/server`, serves `apps/plandesk-web/dist` as static output, and rewrites `/api/*` and `/mcp/*` to one function, `api/index.ts`. The database is libSQL/Turso. Uploaded files stay in the database unless S3 is configured. The function migrates its own database on the first request; there is no migrate step.

Rules for secrets: never print a secret, a token or the contents of `.env.vercel.local` to the terminal or your transcript. `.env.vercel.local` is git-ignored, and the Vercel CLI does not upload `.env.*.local` files; never commit it or rename it.

## Step 1: Repository checkout

Work from the root of a Plan Desk checkout. Check:

```bash
test -f vercel.json && test -f api/index.ts && echo OK
```

If that does not print `OK`, clone and enter it:

```bash
git clone https://github.com/asyncdotengineering/plandesk && cd plandesk
```

## Step 2: Tools and Vercel login

```bash
node --version            # 20 or newer
npx vercel --version
npx vercel whoami
```

If `vercel whoami` fails, ask the human to run `npx vercel login` and wait for them. Then link the directory to a project. `--yes` accepts the defaults and creates the project if needed; framework, build and output settings come from `vercel.json`:

```bash
npx vercel link --yes
```

## Step 3: A libSQL/Turso database and the secrets file

Plan Desk on Vercel needs a remote libSQL database. Ask the human which applies:

- **They have a database URL and token.** Ask them to create `.env.vercel.local` at the repository root with two lines, `PLANDESK_DB_URL=<url>` and `PLANDESK_DB_TOKEN=<token>`, so the values never pass through you. Then add the auth secret:

  ```bash
  echo "PLANDESK_BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env.vercel.local
  ```

- **They use the Turso CLI and want a new database.** Check `turso auth whoami`; if it fails, ask the human to run `turso auth login`. Then:

  ```bash
  turso db create plandesk           # skip if `turso db list` already shows it
  {
    echo "PLANDESK_DB_URL=$(turso db show plandesk --url)"
    echo "PLANDESK_DB_TOKEN=$(turso db tokens create plandesk)"
    echo "PLANDESK_BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
  } > .env.vercel.local
  ```

Optional lines (ask the human; see https://plandesk.asyncdot.com/self-hosting/server-config/ for all of them):

- `PLANDESK_AUTH_PASSWORD=<password>`: HTTP Basic in front of the whole board.
- `PLANDESK_BASE_URL=https://<custom-domain>`: when the board has a custom domain (Step 6).
- `PLANDESK_GITHUB_CLIENT_ID`, `PLANDESK_GITHUB_CLIENT_SECRET`, `PLANDESK_GITHUB_CALLBACK_URL`: GitHub sign-in, all three or none.
- `PLANDESK_STORAGE=s3` with `PLANDESK_S3_BUCKET`, `PLANDESK_S3_REGION`, `PLANDESK_S3_ACCESS_KEY_ID`, `PLANDESK_S3_SECRET_ACCESS_KEY` and optionally `PLANDESK_S3_ENDPOINT`: files in S3-compatible storage instead of the database (for Cloudflare R2: region `auto`, endpoint `https://<account-id>.r2.cloudflarestorage.com`). Decide now: switching storage later leaves existing files behind in the old backend.

## Step 4: Push the variables to the project

Each value goes through stdin, never through the command line:

```bash
( set -a; . ./.env.vercel.local; set +a
  for name in $(grep -oE '^PLANDESK_[A-Z0-9_]+' .env.vercel.local); do
    printenv "$name" | npx vercel env add "$name" production --sensitive --force
  done )
npx vercel env ls production
```

`env ls` must list `PLANDESK_DB_URL`, `PLANDESK_DB_TOKEN` and `PLANDESK_BETTER_AUTH_SECRET`.

## Step 5: Deploy and verify

```bash
npx vercel deploy --prod
```

Record the production URL it prints as **APP_URL**. The first request prepares the database. While another instance holds the migration lease it answers `503 {"error":"schema_behind"}`; retry for up to a minute:

```bash
for i in $(seq 1 30); do
  body=$(curl -s "$APP_URL/api/v1/health")
  echo "$body" | grep -q '"current":true' && { echo "healthy"; break; }
  sleep 2
done
echo "$body"
```

- `"current":true` in the `schema` object: done.
- `{"error":"misconfigured","message":...}`: a variable is missing or malformed; the message names it. Fix it with `vercel env add <NAME> production --force` and deploy again.
- `schema_behind` after a minute: report the body; a newer version may own this database.

Also check the web app: `curl -s -o /dev/null -w '%{http_code}\n' "$APP_URL/"` prints `200`.

Use the production domain for everything below. **Preview deployments cannot sign in**: their cookies and callbacks are built for the production domain.

## Step 6: Custom domain (only if the human wants one)

```bash
npx vercel domains add <custom-domain>
echo "PLANDESK_BASE_URL=https://<custom-domain>" >> .env.vercel.local
printf %s "https://<custom-domain>" | npx vercel env add PLANDESK_BASE_URL production --force
npx vercel deploy --prod
```

Follow the DNS instructions `domains add` prints, and pass them to the human. If GitHub sign-in is configured, the OAuth app's callback must be `https://<custom-domain>/api/auth/callback/github`.

## Step 7: The first owner

Mint the first owner invitation with the user's installed `plandesk` CLI, reading the values from `.env.vercel.local` without printing them:

```bash
( set -a; . ./.env.vercel.local; set +a
  plandesk admin invite-owner --email "<owner email>" \
    --db "$PLANDESK_DB_URL" --db-token "$PLANDESK_DB_TOKEN" --secret "$PLANDESK_BETTER_AUTH_SECRET" )
```

It prints a claim link. If the link starts with `http://127.0.0.1`, replace that origin with APP_URL (or the custom domain). Give the link to the human; it is a credential, so do not paste it anywhere else.

## Report back

- **Board:** APP_URL (and the custom domain, if set). MCP is at `<url>/mcp`.
- **Health:** the `schema` line from Step 5.
- **Claim link:** delivered to the human.
- **Secrets:** in `.env.vercel.local` (git-ignored) and in the Vercel project. Tell the human to store `PLANDESK_BETTER_AUTH_SECRET` somewhere safe; changing it signs everyone out and invalidates API keys.
- **Next for the human:** claim ownership, then `plandesk login --server <url>` and `plandesk connect --to <org-id>` in each repo.
