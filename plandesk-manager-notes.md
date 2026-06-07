# Plan Desk — Program Manager Notes (build complete)

**Program:** Build Plan Desk from the 5-part RFC — a local-first, self-hostable, graph-native planning workspace (canvas + docs-on-nodes + tasks + board + MCP), production-ready, no stubs.
**Method:** `/rfc-to-sprints` → 7-sprint OS; each story delegated to `cursor` via `/delegate`, manager reviewed the real diff + ran live verification, committed atomically. Build branch `main`.
**Completed:** 2026-06-08 · **Tag:** `v1.0.0`

## Shipped (all 7 sprints, every story PROCEED + live-verified)

| Sprint                      | Delivered                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundations               | pnpm/turbo monorepo, strict TS 6.0.3, Drizzle/SQLite schema (8 RFC §4.4 tables), Hono API + CLI (`init`/`serve`, loopback)                                                    |
| 1 Backend core              | REST projects/tasks/canvas/docs behind a single **service-layer SSOT**; **§4.7 layout-only canvas** (clobber-proof); SSE event bus emitted in services                        |
| 2 MCP + portability         | MCP server (`/mcp/`, Streamable HTTP, sha256 tokens), 10 tools (read+write+agent-runs), lossless export/import, full CLI                                                      |
| 3 Web shell+canvas+docs     | React 19 + TanStack Router/Query SPA; xyflow canvas (A-UI-1); TipTap docs (A-UI-2); SSE invalidation; SPA-fallback fix                                                        |
| 4 Board+settings+agent-runs | kanban board (A-UI-3 board→canvas SSE sync); token REST + Settings UI (create/revoke→401); agent-runs panel (live)                                                            |
| 5 Distribution              | `plandesk connect` (RFC §4.7, no committed secrets, idempotent); Docker self-host (real container, non-root, volume); Factory `@plandesk/mcp-client` adapter; dogfood fixture |
| 6 Polish + 1.0              | §9 validation suite + `validate.sh`; §1 metrics (all targets met); README/docs; §10 threat-model; `v1.0.0`                                                                    |

## Manager fixes applied (review caught what tests didn't)

- S0-01: pinned `"latest"`→resolved versions; unified TS 6.0.3; removed stray files.
- S2-01: `/mcp/` trailing-slash routing (RFC-documented URL 404'd).
- S3-02: **SPA fallback** — deep-links/reloads 404'd (found via browser test).
- S5-02: **3 Docker defects** (missing `tsconfig.base.json` in COPY; `pnpm prune --prod` deletes workspace symlinks; incomplete runtime copy) — found only by building+running the image.
- S6-02: Prettier-format METRICS.md.

## Verification highlights (live, not self-report)

- §4.7 canvas clobber regression: status survived a stale-status layout PUT.
- MCP `update_task` → REST GET + SSE `task_updated` (the agent loop).
- Board drag → canvas badge live via SSE (cross-view SSOT).
- `plandesk connect`: no `plandesk_mcp_` in any committed file; idempotent re-run; clean disconnect.
- Docker container: non-root, password gate (401/200), project persists across `docker restart`.
- Metrics independently re-measured: cold start 0.42 s, MCP p95 4.9 ms, SSE p95 1.9 ms, lossless.
- Full README cold-path walkthrough end-to-end.

## Metrics (RFC §1) — all met

cold start 0.42 s (<5 s) · MCP list+inspect p95 4.9 ms (<2 s) · SSE p95 1.9 ms (<500 ms) · export/import lossless. See `METRICS.md`.

## Known follow-ups (v1.x, non-blocking)

- Docker image 551MB — slim via `pnpm deploy --prod` (handle `static.ts` web-dist path).
- RFC housekeeping in `../plandesk-rfc/`: §8 C17 ref to connect; §7.4 stub → §4.7.5 pointer; §4.4 `canvas_layout` note.
- Backlog (WBS §4): Stoker AI bootstrap, Yjs multi-cursor, Spaces/orgs, Postgres adapter, passage comments, audit log, git-native SSOT.

## Process notes

- 7 sprints, ~24 IC stories, ~50 atomic commits on `main`, all green at every closeout.
- Cursor-agent leaves idle processes after committing + leaks test servers if not reaped — reaped each round.
- Build+run infrastructure (Docker, UI) live; never trust static review for it.
