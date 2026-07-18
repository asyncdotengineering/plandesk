---
title: Server configuration
description: The plandesk.server.json config file — one place for every server knob, with environment overrides and source reporting via plandesk doctor.
---

When you run the Plan Desk server yourself (`plandesk serve`, or the [self-host container](./docker/)), every knob is configurable three ways. **Precedence is strict: environment > file > default** (12-factor).

| Source | Wins? | Use for |
| --- | --- | --- |
| **Environment** (`PLANDESK_*`) | ✅ always wins | Secrets, containers, CI — anything that must override the file |
| **File** (`plandesk.server.json`) | when env is unset | Collecting every knob in one place for a self-host operator |
| **Defaults** | last resort | Safe local defaults (loopback host, port 7526, local storage) |

## The config file — `plandesk.server.json`

A single JSON file holding every server setting. It is resolved from your data dir, or from an explicit `--config <path>`:

```bash
plandesk serve --config /etc/plandesk/plandesk.server.json
```

```json
{
  "dbUrl": "libsql://your-db.turso.io",
  "dbToken": "<libSQL auth token>",
  "host": "0.0.0.0",
  "port": 7526,
  "baseUrl": "https://plandesk.example.com",
  "authPassword": "<HTTP basic-auth password>",
  "sessionSecret": "<better-auth secret — long random string>",
  "storage": { "kind": "local" },
  "github": {
    "clientId": "<GitHub OAuth app client id>",
    "clientSecret": "<GitHub OAuth app client secret>",
    "callbackUrl": "https://plandesk.example.com/api/auth/callback/github",
    "dashboardUrl": "/"
  }
}
```

Every field is optional. The keys:

| Key | Env override | Purpose |
| --- | --- | --- |
| `dbUrl` | `PLANDESK_DB_URL` | Remote libSQL/Turso URL. Unset → local file SQLite (the [local topology](./topologies/)). |
| `dbToken` | `PLANDESK_DB_TOKEN` | Auth token for a remote libSQL DB. **Secret.** |
| `host` | `PLANDESK_HOST` | Bind address (`127.0.0.1` loopback default; `0.0.0.0` for LAN/container). |
| `port` | `PLANDESK_PORT` | Bind port (default `7526`). |
| `baseUrl` | `PLANDESK_BASE_URL` | Public base URL the server is reachable at (better-auth `baseURL`, OAuth callbacks, share links). |
| `authPassword` | `PLANDESK_AUTH_PASSWORD` | Enables HTTP basic-auth on the UI/REST API. **Secret.** Recommended for any non-loopback host. |
| `sessionSecret` | `PLANDESK_BETTER_AUTH_SECRET` (`PLANDESK_SESSION_SECRET` accepted for back-compat) | **better-auth secret** (sessions + API keys). **Secret.** Local `serve` auto-generates one under the data dir if unset; set explicitly for multi-replica / durable hosted deploys so sessions and keys stay valid across restarts. |
| `storage` | `PLANDESK_STORAGE` + `PLANDESK_S3_*` | `{ "kind": "local" }` (default, blobs in the DB) or `{ "kind": "s3", "bucket", "region", "accessKeyId", "secretAccessKey", "endpoint"? }`. The S3 `secretAccessKey` is a **secret**. |
| `github` | `PLANDESK_GITHUB_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL`, `PLANDESK_DASHBOARD_URL` | GitHub **social** sign-in for the web dashboard (better-auth). **All-or-nothing**: set all three of client id / secret / callback URL, or none. Register the OAuth app callback as `{baseUrl}/api/auth/callback/github`. The `clientSecret` is a **secret**. Unset → no GitHub sign-in; CLI still uses paste-a-token (`plandesk login`). |

:::caution[This file can hold secrets — gitignore it]
`plandesk.server.json` is in the repo's `.gitignore`. Never commit a file that contains tokens, passwords, or keys. Prefer env (`PLANDESK_*`) for secrets in containers, and keep the file for the non-secret knobs if you like.
:::

## The file is never required

You can run the server with **env alone** and no file at all:

```bash
PLANDESK_DB_URL=libsql://... PLANDESK_DB_TOKEN=... PLANDESK_AUTH_PASSWORD=... plandesk serve --host 0.0.0.0
```

This is exactly how the **edge paths** work. The Cloudflare Workers and Vercel entries read their secrets from the platform (`wrangler secret put …`, Vercel env) and never look for a config file — so the cloud/edge deployment needs **no file at all**. The file is developer convenience, never a dependency.

Edge entries require **`PLANDESK_BETTER_AUTH_SECRET`** (Workers/Vercel env — the canonical name, also accepted by Node `serve`) and should set **`PLANDESK_BASE_URL`** to the public origin. Full Workers steps: [Cloudflare Workers](./cloudflare/).

When one database is served by both `plandesk serve` and a Workers/Vercel deployment, set the exact same secret value in `PLANDESK_BETTER_AUTH_SECRET` on both. Node also accepts the legacy `PLANDESK_SESSION_SECRET`, but it must contain that same value; mismatched values invalidate sessions and API keys across topologies.

## `plandesk doctor` shows where each value came from

`plandesk doctor` resolves the config and prints every key's **value and its source** (`env`, `file`, or `default`), with **secret values always redacted** — they are never printed:

```
config:
  host: 0.0.0.0 (env)
  port: 7526 (default)
  db-url: libsql://your-db.turso.io (env)
  db-token: <redacted> (env)
  base-url: <unset>
  storage: local (default)
  auth-password: <redacted> (env)
  session-secret: <unset>
  github: <unset>
  file: /etc/plandesk/plandesk.server.json
```

Run `plandesk doctor` (optionally with `--config <path>`) to confirm an operator wired the right values from the right places — without ever exposing a secret in a terminal or log.

## A malformed file fails loudly

A present-but-invalid file is an error (a missing file is not). The error names the file and the offending key:

```
/etc/plandesk/plandesk.server.json: "port" must be an integer port (0–65535)
```

## Next

- [Deployment topologies](./topologies/) — local vs self-host vs free-hosted, and who runs migrations.
- [Docker (self-host)](./docker/) — the container quickstart.
