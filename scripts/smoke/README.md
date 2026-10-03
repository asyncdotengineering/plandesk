# smoke-deploy

Boots a self-host target against a throwaway `sqld` and proves it serves.

```sh
pnpm install && pnpm build
node scripts/smoke-deploy.mjs <docker|cloudflare|vercel|all>
```

For each target it asserts, one line each, stopping at the first failure:

1. `GET /api/v1/health` is 200 with `schema.current === true` (the server prepared its own database).
2. An owner key can be minted: `plandesk admin invite-owner --db <url>`, then a session for the shell owner (`helpers.mjs owner-cookie`, standing in for GitHub sign-in) exchanged at `POST /api/v1/auth/cli-token`, the route `plandesk login` uses.
3. `POST /mcp/` `tools/list` returns at least 60 tools.
4. A file uploaded through `POST /api/v1/projects/:id/files` comes back byte-identical from `GET /api/v1/files/:id`.
5. A fresh database at migration N-1 with a held `__plandesk_lease` row gets `503 {error:'schema_behind'}` within 10 s of the target's first answer, and no 2xx.

Every run writes `.agents/factory/runs/smoke-<target>-<timestamp>.log` (gitignored) with all child output, and prints its path.

## Prerequisites

| target     | needs                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| all        | `sqld` (`~/.turso/sqld`, on `PATH`, or `SMOKE_SQLD`), a built workspace (`pnpm build`)                                   |
| docker     | a running Docker daemon, `./Dockerfile`                                                                                  |
| cloudflare | `./wrangler.jsonc`, `packages/plandesk-server/src/worker.ts`, wrangler (`pnpm install`)                                  |
| vercel     | `packages/plandesk-server/dist/vercel.js`; `vercel build` runs only when the CLI is logged in and the checkout is linked |

A missing prerequisite fails that target with one line that names it.

## Env

- `SMOKE_KEEP=1` keeps containers, processes and temp dirs.
- `SMOKE_DOCKERFILE=<path>` builds another Dockerfile (default `Dockerfile`).
- `SMOKE_SQLD=<path>` sets the sqld binary.

Every port is a free random one, bound to `127.0.0.1`. The script never binds or probes 7526 on the host, and the CLI runs with `HOME`, `PLANDESK_DATA_DIR` and `PLANDESK_STATE_DIR` pointed at temp dirs.
