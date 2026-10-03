---
target: docker
store: Node + SQLite or Turso
website: https://docs.docker.com
summary: Build the Plan Desk image from the repository and run the board, REST API and MCP with Docker Compose, on a SQLite volume or your own libSQL/Turso database.
---

# Deploy Plan Desk with Docker

You are an AI coding agent running Plan Desk in Docker on a host the user controls. The user ran `plandesk deploy docker | <you>`. Follow these steps in order and verify each one. Stop and report the exact error if a step fails; do not paper over a half-working deploy.

What gets deployed: the repository's `Dockerfile` builds `plandesk serve` plus the web app (built locally; there is no published image). `compose.yaml` runs it on port 7526, published on the host's `127.0.0.1` only, with data on the `plandesk-data` volume. The server migrates its own database at boot; there is no migrate step.

Rules for secrets: never print a password, a token or the contents of `.env` to the terminal or your transcript. `.env` is git-ignored; never commit it.

## Step 1: Repository checkout and tools

```bash
test -f compose.yaml && test -f Dockerfile && echo OK
```

If that does not print `OK`, clone and enter it:

```bash
git clone https://github.com/asyncdotengineering/plandesk && cd plandesk
```

Then:

```bash
docker --version
docker compose version
```

If either fails, ask the human to install Docker with Compose and stop.

## Step 2: The `.env` file

```bash
test -f .env || cp .env.example .env
```

Fill in the two required values without printing them (the `.bak` suffix keeps `sed -i` portable between macOS and Linux):

```bash
sed -i.bak "s|^PLANDESK_AUTH_PASSWORD=$|PLANDESK_AUTH_PASSWORD=$(openssl rand -hex 16)|" .env
sed -i.bak "s|^PLANDESK_BETTER_AUTH_SECRET=$|PLANDESK_BETTER_AUTH_SECRET=$(openssl rand -hex 32)|" .env
rm -f .env.bak
for n in PLANDESK_AUTH_PASSWORD PLANDESK_BETTER_AUTH_SECRET; do
  grep -q "^$n=." .env && echo "$n set" || echo "$n MISSING"
done
```

If the human wants to choose the password themselves, ask them to edit `PLANDESK_AUTH_PASSWORD` in `.env` instead. Tell them where it is: they sign in with user `plandesk` and that password.

Ask the human about the optional settings and, if they want any, have them set the lines in `.env` (all names: https://plandesk.asyncdot.com/self-hosting/server-config/):

- **Database.** Default: a SQLite file on the volume. For libSQL/Turso, `PLANDESK_DB_URL` and `PLANDESK_DB_TOKEN`.
- **Public URL.** `PLANDESK_BASE_URL=https://<domain>` when a reverse proxy will serve it on a domain (Step 5).
- **Host port.** `PLANDESK_HOST_PORT` (default 7526).
- **Files.** Default: in the database. For S3-compatible storage, `PLANDESK_STORAGE=s3` and `PLANDESK_S3_*`. Decide now: switching later leaves existing files behind in the old backend.
- **GitHub sign-in.** `PLANDESK_GITHUB_CLIENT_ID`, `PLANDESK_GITHUB_CLIENT_SECRET`, `PLANDESK_GITHUB_CALLBACK_URL`, all three or none.

## Step 3: Build and start

```bash
docker compose up --build -d
```

The first build takes a few minutes.

## Step 4: Verify

```bash
PORT=$(grep -E '^PLANDESK_HOST_PORT=.+' .env | cut -d= -f2); PORT=${PORT:-7526}
for i in $(seq 1 45); do
  body=$(curl -s "http://127.0.0.1:$PORT/api/v1/health")
  echo "$body" | grep -q '"current":true' && { echo "healthy"; break; }
  sleep 2
done
echo "$body"
docker compose ps
```

- `"current":true` in the `schema` object and `(healthy)` in `docker compose ps`: done.
- No answer: `docker compose logs --tail 50 plandesk` and report the error. A configuration error (for example a half-set S3 or GitHub group, or the retired `PLANDESK_SESSION_SECRET`) names the variable.
- `503 {"error":"schema_behind"}` that does not clear: another server, possibly a newer version, holds this database. Report it.

`docker compose run --rm plandesk doctor` prints the resolved settings with secrets redacted.

## Step 5: Domain and TLS (only if the human wants one)

The container binds `0.0.0.0` inside, and compose publishes it on the host's `127.0.0.1:$PORT`. Put a reverse proxy (Caddy, nginx, Traefik) on the host in front of `127.0.0.1:$PORT` for HTTPS. Ask the human which proxy they use; for Caddy the whole site block is:

```text
<domain> {
  reverse_proxy 127.0.0.1:7526
}
```

Then set `PLANDESK_BASE_URL=https://<domain>` in `.env` and apply it:

```bash
docker compose up -d
```

Do not replace the container with `plandesk serve --host 127.0.0.1` behind the proxy: a loopback bind makes every request the owner, with no login.

## Step 6: The first owner

With the default file database, run inside the container:

```bash
docker compose run --rm plandesk admin invite-owner --email "<owner email>"
```

With `PLANDESK_DB_URL` set, use the user's installed CLI against that database:

```bash
( set -a; . ./.env; set +a
  plandesk admin invite-owner --email "<owner email>" \
    --db "$PLANDESK_DB_URL" --db-token "$PLANDESK_DB_TOKEN" --secret "$PLANDESK_BETTER_AUTH_SECRET" )
```

It prints a claim link on `PLANDESK_BASE_URL` (inside the container, compose defaults it to `http://127.0.0.1:<port>`). If the CLI warns that no base URL is set, rerun it with `--base-url "<board URL>"`. Give the link to the human; it is a credential, so do not paste it anywhere else.

## Report back

- **Board:** `http://127.0.0.1:<port>` (and the domain, if set). MCP is at `<url>/mcp`.
- **Health:** the `schema` line from Step 4.
- **Data:** the `plandesk-data` volume, or the remote database. Tell the human to back it up; an older image cannot run on a database a newer one migrated.
- **Upgrade later:** `git pull && docker compose up --build -d`.
- **Secrets:** in `.env` (git-ignored). Tell the human to store `PLANDESK_BETTER_AUTH_SECRET` somewhere safe.
- **Next for the human:** claim ownership, then `plandesk login --server <url>` and `plandesk connect --to <org-id>` in each repo.
