# Sprint 5 Warm-down — Distribution + integration + dogfood

**Closed:** 2026-06-08 · **Status:** ✅ complete · **Build branch:** `main`

## What shipped — Plan Desk is now distributable

| Story | Commit | Delivers |
|-------|--------|----------|
| S5-01 | `693b5a6` | `plandesk connect`/`disconnect` + `.plandesk/` + `.mcp.json` (env-var) + idempotent CLAUDE.md/AGENTS.md include (RFC §4.7) |
| S5-02 | `6c50fb3` + `d86d8f1` | Docker self-host (non-root, password-gated 0.0.0.0, volume-persistent) |
| S5-03 | `d517101` | `@plandesk/mcp-client` Factory adapter (MCP-only, lists projects) |
| S5-04 | `435cac3` | `examples/checkout-revamp.json` dogfood fixture (lossless import) |

## What's working (live-verified)

- `plandesk connect` in a real repo → secure artifacts, no committed secrets, idempotent, clean disconnect.
- `docker build` + `docker run` → UI+API+MCP on :3847; non-root; auth gate (401/200); project persists across restart.
- Adapter lists a project over MCP with a Bearer token; bad token rejected.
- Dogfood imports (8 tasks/6 edges/3 docs) + MCP `get_project`.
- All gates green.

## What's NOT done (Sprint 6 — final)

- Wire all §9 fail-to-pass tests + §9.3 validation commands into `pnpm test` / `scripts/validate.sh`.
- Measure §1 metrics: cold start <5 s, MCP list/inspect <2 s p95, SSE <500 ms, lossless export → `METRICS.md`.
- Top-level README (quickstart, self-host, MCP setup), `docs/mcp-setup.md`, `docs/skills/plandesk-mcp.md`, CHANGELOG.
- §10 threat-model checklist; tag `v1.0.0`.
- RFC housekeeping (C17 ref, §7.4 pointer, §4.4 canvas_layout note).

## Decisions / conventions (carry forward)

- **Docker:** no `pnpm prune --prod` (breaks workspace symlinks); image 551MB; v1.x slim via `pnpm deploy`. `PLANDESK_HOST`/`PLANDESK_AUTH_PASSWORD` gate the UI/REST; MCP stays Bearer.
- **connect:** raw token only in gitignored `.plandesk/token`; `.mcp.json` uses `${PLANDESK_MCP_TOKEN}`; sentinel-block idempotency.
- **adapter:** async `createPlandeskClient`; MCP-only.

## Process notes

- **Build + run infra, don't trust static review** — the Docker story passed unit tests but had 3 real defects only a live build+run exposed.
- Reap test servers + agent stragglers each round (one stray server lingered from Docker runs; reaped).

## Open issues / RFC amendments

- Docker image size (551MB) — v1.x `pnpm deploy` optimization.
- RFC housekeeping deferred to S6 docs pass.
- No blockers. Product feature-complete + distributable.
