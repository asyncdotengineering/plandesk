---
title: Server configuration
description: Every environment variable the Plan Desk server reads, the rules it applies to them, the plandesk.server.json file, storage choices and plandesk doctor.
---

Every target — `plandesk serve` (and the Docker image, which runs it), Cloudflare Workers and Vercel — reads its settings through one function, `readServerEnv`, so the names and rules below are the same everywhere. This page is the single reference; the target guides link here instead of repeating it.

## Environment variables

| Variable                        | Targets             | Default                                    | Purpose                                                                                                                                                               |
| ------------------------------- | ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLANDESK_DB_URL`               | all                 | Node: a SQLite file in the data dir        | libSQL/Turso URL, e.g. `libsql://plandesk-you.turso.io`. **Required on Workers and Vercel.**                                                                          |
| `PLANDESK_DB_TOKEN`             | all                 | (unset)                                    | Auth token for `PLANDESK_DB_URL` (`turso db tokens create <db>`). **Secret.**                                                                                         |
| `PLANDESK_BETTER_AUTH_SECRET`   | all                 | Node with a file DB: generated in data dir | Signs sessions and API keys (`openssl rand -hex 32`). **Secret.** Required on Workers and Vercel and with any remote database. Keep it stable across deploys.         |
| `PLANDESK_BASE_URL`             | all                 | see [Custom domains](#custom-domains)      | Public origin: sign-in cookies, OAuth callbacks, share links. Set it whenever the board has a domain of its own.                                                      |
| `PLANDESK_AUTH_PASSWORD`        | all                 | (unset)                                    | HTTP Basic password (user `plandesk`) in front of the UI and REST API. **Secret.** Recommended off loopback; compose requires it.                                     |
| `PLANDESK_STORAGE`              | all                 | `db`                                       | Where file bytes live: `db` (in the database) or `s3`. `local` is the old name for `db` and is still accepted. Ignored on Workers when the `FILES` R2 binding exists. |
| `PLANDESK_S3_BUCKET`            | all                 | (unset)                                    | Bucket name. Needs `PLANDESK_STORAGE=s3`.                                                                                                                             |
| `PLANDESK_S3_REGION`            | all                 | (unset)                                    | Region, e.g. `us-east-1`, or `auto` for R2.                                                                                                                           |
| `PLANDESK_S3_ACCESS_KEY_ID`     | all                 | (unset)                                    | Access key id.                                                                                                                                                        |
| `PLANDESK_S3_SECRET_ACCESS_KEY` | all                 | (unset)                                    | Secret access key. **Secret.**                                                                                                                                        |
| `PLANDESK_S3_ENDPOINT`          | all                 | AWS                                        | S3-compatible endpoint (R2, MinIO, …), e.g. `https://<account-id>.r2.cloudflarestorage.com`.                                                                          |
| `PLANDESK_GITHUB_CLIENT_ID`     | all                 | (unset)                                    | GitHub OAuth app client id. All three GitHub variables together, or none.                                                                                             |
| `PLANDESK_GITHUB_CLIENT_SECRET` | all                 | (unset)                                    | GitHub OAuth app client secret. **Secret.**                                                                                                                           |
| `PLANDESK_GITHUB_CALLBACK_URL`  | all                 | (unset)                                    | `<PLANDESK_BASE_URL>/api/auth/callback/github`, registered on the OAuth app.                                                                                          |
| `PLANDESK_DASHBOARD_URL`        | all                 | (unset)                                    | Where to send the browser after GitHub sign-in (optional).                                                                                                            |
| `PLANDESK_HOST`                 | Node                | `127.0.0.1` (the image: `0.0.0.0`)         | Bind address. See [the bind address is the trust boundary](/self-hosting/docker/#the-bind-address-is-the-trust-boundary).                                             |
| `PLANDESK_PORT`                 | Node                | `7526`                                     | Listen port. The image always listens on 7526.                                                                                                                        |
| `PLANDESK_DATA_DIR`             | Node                | nearest `.plandesk/`, else `~/.plandesk`   | Data directory: the SQLite file, the generated secret, `plandesk.server.json`. The image uses `/data`.                                                                |
| `PLANDESK_HOST_PORT`            | `compose.yaml` only | `7526`                                     | Host port compose publishes the container on.                                                                                                                         |

[`.env.example`](https://github.com/asyncdotengineering/plandesk/blob/main/.env.example) lists the same names with a comment each; [`.dev.vars.example`](https://github.com/asyncdotengineering/plandesk/blob/main/.dev.vars.example) lists the Workers secrets.

### Rules

- **Values are trimmed and blank means unset.** `PLANDESK_DB_URL=` in an env file is the same as not setting it.
- **Groups are all-or-nothing.** A half-set group is an error that names what is missing, never a silently disabled feature:
  - GitHub: client id, client secret and callback URL together, or none.
  - S3: `PLANDESK_STORAGE=s3` needs bucket, region, access key id and secret access key. Setting any `PLANDESK_S3_*` without `PLANDESK_STORAGE=s3` is also an error.
- **`PLANDESK_SESSION_SECRET` is no longer read.** If it is set and `PLANDESK_BETTER_AUTH_SECRET` is not, the server refuses to start and tells you to rename it. Same value, new name.
- **One secret per database.** When one database is served by more than one deployment (say Docker and Workers), give them the same `PLANDESK_BETTER_AUTH_SECRET`; otherwise each invalidates the other's sessions and API keys.

How a bad value surfaces: `plandesk serve` refuses to start and prints the message. Workers and Vercel answer every request with `500 {"error":"misconfigured","message":"…"}` naming the variable.

## Storage

Uploaded files (attachments, images, prototype assets) go to one of three places:

| Backend              | Where it works | How to choose it                                                                                            |
| -------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| Database (`db`)      | every target   | The default. Bytes live next to the board, so a database backup covers them.                                |
| R2 binding           | Workers only   | The `FILES` binding in `wrangler.jsonc`. When it exists it wins over everything else.                       |
| S3-compatible (`s3`) | every target   | `PLANDESK_STORAGE=s3` plus the `PLANDESK_S3_*` variables. Works with AWS S3, R2's S3 API, MinIO and others. |

On Workers the R2 binding needs no keys: keep `FILES` in `wrangler.jsonc` and leave `PLANDESK_S3_*` unset. On Vercel and Docker, R2 is reachable only through its S3 API: `PLANDESK_STORAGE=s3`, region `auto`, endpoint `https://<account-id>.r2.cloudflarestorage.com` and an R2 API token's key pair.

:::caution[Pick storage before you upload]
Switching backends later does not move anything. Files already stored stay in the old backend, and the board can no longer read them from the new one. Choose before the first upload, or copy the objects across yourself when you switch.
:::

## Custom domains

Set `PLANDESK_BASE_URL` to the origin people open, e.g. `https://plan.example.com`. Sign-in cookies, the GitHub callback and share links are all built on it. Without it:

- **Docker / `plandesk serve`** uses compose's `http://127.0.0.1:<PLANDESK_HOST_PORT>`, or the bind host and port.
- **Workers** use the origin of the first request each isolate sees. If the Worker answers on both `*.workers.dev` and your domain, that is whichever was hit first, so set the variable.
- **Vercel** uses the project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`). Preview deployments therefore cannot sign in: their cookies and callbacks point at the production domain, not the preview URL.

If you use GitHub sign-in, update the OAuth app's callback URL and `PLANDESK_GITHUB_CALLBACK_URL` when the domain changes.

## The config file: `plandesk.server.json`

`plandesk serve` (and so the Docker image) can also read a JSON file from the data directory, or from `--config <path>`. Precedence is **environment > file > default**, per key. Workers and Vercel read only their environment.

```json
{
  "dbUrl": "libsql://plandesk-you.turso.io",
  "dbToken": "<token>",
  "host": "0.0.0.0",
  "port": 7526,
  "baseUrl": "https://plan.example.com",
  "authPassword": "<password>",
  "sessionSecret": "<better-auth secret>",
  "storage": { "kind": "db" },
  "github": {
    "clientId": "<client id>",
    "clientSecret": "<client secret>",
    "callbackUrl": "https://plan.example.com/api/auth/callback/github",
    "dashboardUrl": "/"
  }
}
```

Every key is optional. They map onto the variables above; `sessionSecret` is the file's name for `PLANDESK_BETTER_AUTH_SECRET`. `storage` is `{ "kind": "db" }` or `{ "kind": "s3", "bucket", "region", "accessKeyId", "secretAccessKey", "endpoint"? }`. Setting `PLANDESK_STORAGE` replaces the file's `storage` block as a whole, and the GitHub variables replace its `github` block. An unknown key or a wrong type fails at start, naming the file and the key:

```text
/etc/plandesk/plandesk.server.json: "port" must be an integer port (0–65535)
```

:::caution[The file can hold secrets]
Never commit it. Prefer environment variables for secrets and keep the file for the rest.
:::

## `plandesk doctor`

`plandesk doctor` prints each resolved setting and where it came from (`env`, `file` or `default`). Secrets are never printed:

```text
config:
  host: 0.0.0.0 (env)
  port: 7526 (default)
  db-url: libsql://plandesk-you.turso.io (env)
  db-token: <redacted> (env)
  base-url: https://plan.example.com (env)
  storage: db (default)
  auth-password: <redacted> (env)
  auth-secret: <redacted> (env)
  github: <unset>
  file: <none>
```

In the container: `docker compose run --rm plandesk doctor`.

## Next

- [Deployment topologies](/self-hosting/topologies/): which target to pick, and how the database is prepared.
- [Docker](/self-hosting/docker/) · [Cloudflare Workers](/self-hosting/cloudflare/) · [Vercel](/self-hosting/vercel/)
