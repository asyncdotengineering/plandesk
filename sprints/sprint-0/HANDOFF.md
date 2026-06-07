# Sprint 0 → Sprint 1 Handoff

**Read me first.** One page to start Sprint 1 (Backend core: REST + SSE).

## State of the world

- Repo: `/Users/mithushancj/Documents/personal/plan-desk/plandesk`, branch `main`, all green.
- `pnpm build && pnpm test && pnpm lint` pass. `plandesk init && plandesk serve` work (health on `127.0.0.1:3847`).
- Packages: `@plandesk/{api,db,mcp,cli,mcp-client}` + `plandesk-web`. Only api+db+cli have real code; mcp/mcp-client/web are compiling shells.

## What Sprint 1 builds (WBS § Sprint 1)

REST CRUD for projects/tasks, canvas+edges round-trip, documents linked to tasks, and SSE — **all through one service layer that is the single SSOT.**

- **S1-01** REST projects + tasks behind `projectService`/`taskService` (the SSOT layer).
- **S1-02** REST canvas + edges with the **§4.7 concurrency fix**: `PUT /canvas` is **layout-only** (x/y/edges); task status/label/description go through `PATCH /tasks/:id`. Regression test that a layout PUT doesn't clobber a concurrent status PATCH.
- **S1-03** REST documents (link to task; cross-project link rejected).
- **S1-04** SSE event bus emitted **inside the service layer** so every mutation broadcasts (`task_updated` < 500 ms).

## Load-bearing reading for Sprint 1

1. `sprints/WBS.md` § Sprint 1 + § 1.2 DoD.
2. `../plandesk-rfc/02-requirements-interfaces.md` §4.2 (REST table), §4.7 (canvas-concurrency fix — **critical for S1-02**), §3 REQ-1/2/3/4/5/9.
3. `../plandesk-rfc/03-pseudocode-blueprint.md` §6.2 (canvas save), §6.4 (doc create), §7.1 (Hono+SSE sketch), §7.2 (update_task).
4. `../plandesk-rfc/04-tasks-validation.md` §9.1 tests (`test:canvas_roundtrip`, `test:doc_link`, `test:sse_task_update`).
5. This sprint's `WARMDOWN.md` for conventions (timestamps, service-layer rule).

## Critical conventions to carry

- **Service layer is the only write path.** Routes call `taskService.update()` etc.; the service mutates the db AND emits the SSE event. No route touches the db client directly. This is what makes REQ-5 (SSOT) and REQ-9 (MCP writes broadcast SSE) true in S2 without rework.
- **Canvas PUT is layout-only** (§4.7). Semantic task fields never travel on the whole-canvas PUT.
- DB surface: `createDb(path)`, `migrate(db)`, `Db` type, projects/tasks repositories. Extend repositories for edges/documents in S1; keep them thin — business logic + SSE live in the service layer above them.
- ESM/NodeNext (`.js` imports), strict TS 6.0.3, no stubs/`@ts-ignore`, atomic `[S1-NN]` commits, no scratch files.
- Timestamps: serialize `timestamp_ms` → ISO at the REST edge.

## Starting state for Sprint 1

Clean `main`, Sprint 0 closed. Next action: write `sprints/sprint-1/PLAN.md`, then brief S1-01 → `/delegate --mode impl --to cursor`.
