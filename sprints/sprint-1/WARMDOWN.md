# Sprint 1 Warm-down — Backend core (REST + SSE)

**Closed:** 2026-06-07 · **Status:** ✅ complete · **Build branch:** `main`

## What shipped

The full local REST + SSE backend, all behind a single service-layer SSOT.

| Story | Commit | Delivers |
|-------|--------|----------|
| S1-01 | `415cd6c` | projects+tasks REST via `projectService`/`taskService` (the SSOT write path) |
| S1-02 | `be02b00` | canvas+edges REST, **§4.7 layout-only PUT** (clobber-proof), edges repo |
| S1-03 | `aa0e9f1` | documents REST, task-linking, cross-project isolation |
| S1-04 | `bddcd63` | in-process SSE event bus, emitted inside services, `GET /events` |

## What's working (live-verified)

- `GET/POST /projects`, `GET /projects/:id` (+status summary), `GET /projects/:id/tasks` (filter), `PATCH /tasks/:id`.
- `GET/PUT /projects/:id/canvas` — layout-only PUT proven not to clobber status.
- `GET/POST /projects/:id/documents`, `GET/PATCH /documents/:id`, `GET /tasks/:id/document`; cross-project link → 400.
- `GET /api/v1/events` SSE — `task_updated` delivered after PATCH, live.
- 55 api + 25 db behavioral tests; `pnpm build && pnpm test && pnpm lint` green.

## What's NOT done (later sprints)

- No MCP server/tools yet → **Sprint 2** (reuses these services behind MCP).
- No export/import, no `token`/`doctor`/`export`/`import` CLI → Sprint 2.
- No UI behavior beyond build → Sprint 3.
- Agent-run SSE event *types* defined but not emitted → emitted in S2 when agent-run tools land.

## Decisions / conventions (carry forward)

- **JSON wire = snake_case + ISO**, via shared `packages/plandesk-api/src/serialize.ts`. **S2 MCP tool outputs and S3 web client must use/expect this.** Single source of truth for shapes.
- **Services accept `{db, eventBus}`** and are the only write path. **S2 MCP tools call these same services** — do NOT write a second mutation path in the MCP package.
- **§4.7 layout-only canvas**: semantic task fields are PATCH-only; canvas PUT moves nodes + reconciles edges.
- `CanvasNodeInput.status?` accepted-and-ignored (intentional, robust round-trip).
- No `POST /tasks` (RFC §4.2) — tasks are created via canvas PUT or MCP `create_task`.

## Open issues / RFC amendments

- **RFC delta (additive):** `projects.canvas_layout text` column (migration `0001`) for the documented canvas `layout` field — fold a note into RFC §4.4 at S5 doc pass.
- Standing: §4.7 `plandesk connect` lands in Sprint 5.
- No blockers.
