# Proceed Evidence — S4-01 Board view (C14, A-UI-3)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `bbd0bfd` `[S4-01] Board view` (cursor)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S4-01)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Columns per status; cards from `useTasks` | ✅ Board/BoardColumn/TaskCard; `@dnd-kit/core@6.3.1` |
| 2 | Drag card → `PATCH /tasks/:id` status | ✅ `useBoardDnd.handleDragEnd` → `patchTask.mutate`; not canvas PUT |
| 3 | **A-UI-3: canvas badge updates live via SSE, no reload** | ✅ **browser-verified** (below) |

## Independent verification (manager-run, real browser)

- Opened `/projects/:id/flow`: node badge = "Build checkout **todo**".
- PATCHed `t1` → `done` (the exact mutation `useBoardDnd` performs on drop).
- **Without reload**, polled the canvas DOM → badge became "Build checkout **done**" via SSE; still on `/flow`. Single-SSOT cross-view sync (REQ-5) proven.
- Board status path: `useBoardDnd` → `patchTask` (PATCH), never canvas PUT — verified by grep + `board.test.tsx` drag-mapping test.
- Gates: build 6/6, web 22 tests, lint+Prettier clean. No strays/leaks.

→ Proceed to **S4-02 (MCP settings UI + token REST endpoints)**.
