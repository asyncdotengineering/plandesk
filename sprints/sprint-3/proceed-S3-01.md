# Proceed Evidence — S3-01 Web shell + routing + API client (C11)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `f3b2f91` `[S3-01] Web shell + routing + API client` (cursor)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S3-01)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | web build + full build green; web tests | ✅ web build 317KB; web 6 tests |
| 2 | routes resolve (index/overview/flow/board/documents/settings) | ✅ all route files compile (routeTree regen) |
| 3 | project list from `GET /projects`; create; navigate | ✅ live: SPA served + API lists "Checkout Revamp" |
| 4 | typed API client matches serialize.ts snake_case; typed search params | ✅ client uses created_at/project_id/status_line/linked_task_id/from_task_id; `lib/search.ts` |
| 5 | SSE hook subscribes + invalidates | ✅ `EventSource('/api/v1/events')` → invalidateQueries per event type |
| 6 | Vite dev proxy /api + /mcp | ✅ proxy → 127.0.0.1:3847 |

## Independent verification (manager-run)

- Gates: `pnpm build` 6/6, web 6 tests, lint+Prettier clean. No strays/leaks.
- `lib/api.ts` typed to the snake_case API; `lib/events.ts` invalidates `project/tasks/taskDocument/canvas/documents/document` query keys on `task_updated`/`canvas_updated`/`document_created`.
- **Live same-origin integration:** built SPA → `plandesk serve` serves it at `/` (`<title>Plan Desk</title>`, bundle `/assets/*.js` → 200) and the same-origin `GET /api/v1/projects` returns the created project the list renders. One process serves UI + API (production self-host shape; static hook from S0-03 + SPA from S3-01).

## Notes for S3-02/03

- Route placeholders for flow/board/documents/settings compile and render; canvas (S3-02), board (S4-01), doc editor (S3-03), settings (S4-02) fill them.
- API client already has `getCanvas`/`putCanvas`/`patchTask`/document methods — S3-02/03 consume them. **Canvas PUT must stay layout-only** (client method should send only nodes x/y + edges).
- SSE invalidation already wired → canvas/board will update live with MCP/agent writes for free.

→ Proceed to **S3-02 (Flow canvas, A-UI-1 — needs real browser verification)**.
