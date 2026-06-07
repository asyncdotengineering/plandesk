# Proceed Evidence — S1-01 REST projects + tasks via service layer (C3)

**Verdict:** `PROCEED` (no manager fix needed)
**IC commit:** `415cd6c` `[S1-01] REST projects + tasks via service layer` (cursor)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S1-01)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | POST/GET projects, GET :id + summary counts, 404 | ✅ live: create→UUID, detail has `summary` by status, unknown→404 |
| 2 | GET :id/tasks (filters), PATCH /tasks/:id | ✅ list `[]`, filter honored, PATCH wired |
| 3 | invalid status→400 invalid_argument; unknown→404 not_found | ✅ `?status=bogus`→400; PATCH unknown task→404 |
| 4 | All mutations through service layer (no route→db direct) | ✅ routes call `taskService.update`/`projectService.*`; only the `InvalidTaskStatusError` class + `isTaskStatus` guard imported into routes (error-mapping, not a write path) |
| 5 | updated_at bumps; ISO timestamps | ✅ `created_at:"2026-06-07T…Z"` ISO confirmed |
| 6 | Behavioral tests happy+failure | ✅ 23 api tests pass |

## Independent verification (manager-run, live server)

- Booted real server on a temp DB; `POST /projects` → UUID; `GET /projects/:id` → name + `summary` counts + ISO `created_at`; `GET /projects/:id/tasks` → `[]`; `?status=bogus` → 400; unknown project/task → 404.
- Read `routes/tasks.ts` + `services/tasks.ts`: route takes a `TaskService`, mutation is `taskService.update()` → `updateTask(db,…)` in the service. **SSOT discipline holds.** Service signature `createTaskService(deps)` cleanly accepts an eventBus dep in S1-04.
- Gates: `pnpm build` 6/6, `pnpm test` (api 23, cli 12, …), `pnpm lint` + Prettier clean.
- No strays/leaks.

## Decisions / conventions to carry

- **JSON wire format is snake_case** (`created_at`, `project_id`, `due_date`, `summary`) via shared `serialize.ts`. Timestamps ISO. → **S2 MCP tools and S3 web client must use these same serializers / expect snake_case.** Shared `serialize.ts` is the single place to keep this consistent.
- **No `POST /tasks`** endpoint — correct per RFC §4.2 (tasks are created via canvas upsert in S1-02 and MCP `create_task` in S2). `taskService` currently exposes `listByProject` + `update`; `create` arrives with canvas (S1-02).
- `serialize.ts` exposes `emptyTaskStatusSummary`, `serializeProject(Detail)`, `serializeTask` — reuse in S1-02/03.

→ Proceed to **S1-02 (REST canvas + edges, §4.7 layout-only PUT)**.
