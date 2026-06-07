# Proceed Evidence — S5-02 Docker self-host (C18)

**Verdict:** `PROCEED`
**IC commit:** `6c50fb3` `[S5-02]` (cursor)
**Manager fix:** `d86d8f1` `[S5-02-fix]` (3 Docker build/runtime defects)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S5-02)

| # | Criterion | Result (real container) |
|---|-----------|-------------------------|
| 1 | `serve` honors `PLANDESK_HOST`; non-loopback w/o password → refuse | ✅ live: 0.0.0.0 + no password → "binding to a non-loopback address requires PLANDESK_AUTH_PASSWORD" |
| 2 | Password gate: creds 200, none/wrong 401; MCP Bearer unchanged | ✅ health 401/200; MCP no-token 401 |
| 3 | Dockerfile multi-stage, non-root, EXPOSE 3847, serves SPA+API | ✅ user `plandesk`; SPA `<title>Plan Desk</title>` |
| 4 | compose single service, env, 3847, named volume | ✅ one service; volume `plandesk-data` at /data |
| 5 | `docker compose up`/run serves on :3847; DB persists | ✅ project survived `docker restart` (volume) |

## Independent verification (manager-run, REAL Docker build + run)

OrbStack daemon started; `docker build` + `docker run`:
- Non-root `plandesk`; `EXPOSE 3847`; serves built SPA + API + MCP.
- Auth gate: `/api/v1/health` → 401 (no creds) / 200 (`-u plandesk:secret123`); `/mcp/` → 401 without Bearer.
- **Persistence:** created a project → `docker restart` → project still listed (named volume `/data`).
- REQ-6 (serve level, also live): 0.0.0.0 without `PLANDESK_AUTH_PASSWORD` refuses to start.
- Gates: build 6/6, full suite green, lint clean.

## Manager fixes (3 real defects — found only by actually building+running, not static review)

1. **Build COPY omitted `tsconfig.base.json`** → every package's `tsc` (`extends ../../tsconfig.base.json`) failed instantly in-container.
2. **`pnpm prune --prod` deletes per-package `node_modules/@plandesk/*` symlinks** → runtime `ERR_MODULE_NOT_FOUND: @plandesk/db`. Verified via a build-stage inspection (links present after install, GONE after prune). Removed the prune step.
3. **Runtime cherry-picked `dist/` only** → copy full `packages` so workspace symlinks + `.pnpm` store resolve.

## Known tradeoff / follow-up (noted, not a workaround)

- Image is **551MB** because we keep build deps to preserve pnpm workspace resolution (prune breaks it). Honest, documented in the Dockerfile. **v1.x optimization:** use `pnpm deploy --prod` to produce a self-contained prod bundle (needs handling the `static.ts` web-dist relative path) — would shrink the runtime image. Core platform rules honored now: single slim non-root container, SQLite on a volume, no managed DB.

→ Proceed to **S5-03 (Factory Desk adapter)**.
