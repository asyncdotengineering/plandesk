# Sprint 4 Warm-down — Web: board + MCP settings + agent runs

**Closed:** 2026-06-08 · **Status:** ✅ complete · **Build branch:** `main`

## What shipped — the UI is now feature-complete

| Story | Commit | Delivers |
|-------|--------|----------|
| S4-01 | `bbd0bfd` | kanban board; drag→PATCH status; canvas badge syncs live (SSE, REQ-5) |
| S4-02 | `a59b9ca` | token REST (create/list/revoke) + MCP Settings UI (raw once, copy, revoke→401) |
| S4-03 | `fbf5452` | agent-runs read endpoint + "Agents activity" panel, live via SSE |

## What's working (browser + REST verified)

- Board drag → canvas badge live (A-UI-3). Token create→use→revoke→401. Agent run start/progress/complete → panel live RUNNING→COMPLETED, no reload.
- 182 tests (api 77, web 31, db 40, mcp 8, cli 26); build + lint green.
- Whole product usable in a browser: overview · flow canvas · board · documents · settings · agent panel.

## What's NOT done (Sprints 5–6)

- **Distribution:** `plandesk connect` + `.plandesk/` (RFC §4.7), Docker self-host, Factory Desk MCP-client adapter, dogfood fixture → **Sprint 5**.
- **Polish/1.0:** §9 validation suite wired into `pnpm test`, §1 metrics (cold start/MCP p95/SSE), §10 threat-model checklist, README/docs, `v1.0.0` → **Sprint 6**.

## Decisions / conventions (carry forward)

- Board status via `PATCH /tasks/:id`; never canvas PUT. Canvas/board/panel all live-update via the shared SSE invalidation hook (`events.ts` now handles task/canvas/document/agent_run events).
- Token endpoints: `POST/GET/DELETE /api/v1/mcp-tokens`; list never returns hash/raw.
- Agent-runs: `GET /api/v1/projects/:id/agent-runs` (runs + events).

## Process notes (from this sprint)

- **Reap test servers + agent stragglers each round.** My live `plandesk serve` tests leaked node servers that collided with the CLI port test (transient 11/12; reaped → 12/12). Cursor-agent also leaves idle processes after committing — kill finished ones so the process list reflects reality.
- Browser checks remain string-case-aware (the UI uppercases statuses).

## Open issues / RFC amendments

- Carried: additive `projects.canvas_layout` (S1); SPA fallback (S3, fixed).
- **Sprint 5 folds the RFC §4.7 work** (`plandesk connect` + `.plandesk/`) and should: update §8 C17 to reference `connect`, supersede the §7.4 skill stub with §4.7.5, note the `canvas_layout` column in §4.4.
- No blockers. Backend + UI feature-complete for v1.
