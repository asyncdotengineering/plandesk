# Sprint 1 Review (Phase B) — Backend core (REST + SSE)

**Reviewer:** Manager (Opus 4.8), 2026-06-07
**Scope:** `415cd6c`, `be02b00`, `aa0e9f1`, `bddcd63` on `main`
**Sprint goal:** CRUD projects/tasks, round-trip canvas+labeled edges, link a doc to a task, SSE `task_updated` < 500 ms — all through one service layer that is the single SSOT.

## Verdict: **SOLID — shipping.** Goal met; the SSOT + §4.7 disciplines hold under live test.

## Layer 1 — What works (grounded, live-verified)

- **Service layer is genuinely the only write path.** No route imports a db write fn; routes import only the `InvalidTaskStatusError` class + `isTaskStatus` guard for HTTP mapping. Mutations go through `{project,task,canvas,document}Service`. This is what makes REQ-5 (SSOT) and REQ-9 (MCP writes broadcast) true *for free* in Sprint 2.
- **§4.7 canvas layout-only is proven, not claimed.** Live: PATCH task→`in_progress`, then PUT canvas with stale `status:"todo"`+new coords → status stayed `in_progress`, x/y updated. The clobber bug is structurally impossible (`updateTask(tx,id,{x,y})` only).
- **SSE works end-to-end.** Live `curl -N /events` received `task_updated` after a PATCH; emit is in-service so MCP inherits it. Synchronous bus → sub-ms, well within 500 ms.
- **Doc linking + project isolation.** Live: linked doc resolves via `/tasks/:id/document`; cross-project link → 400.
- **Consistent wire format.** snake_case JSON + ISO timestamps via shared `serialize.ts` — one place to keep MCP (S2) and web (S3) aligned.
- **Test depth:** 55 api + 25 db behavioral tests, happy + failure per surface. Multi-row canvas upsert + edge reconcile wrapped in a transaction.

## Layer 2 — Blockers / majors

**None.** No manager fixes were required this sprint (S1-01..04 all PROCEED as-delivered). Notes carried, not debt:

- `CanvasNodeInput.status?` is accepted-and-ignored by design (robust round-trip; guarantee holds). Documented in proceed-S1-02 as intentional.
- Schema delta `0001`: additive `projects.canvas_layout text` for the documented `layout` field. RFC §4.4 didn't list it → fold a one-line note into the RFC data-model section (tracked, non-blocking).

## Layer 3 — Verdict

**SOLID — shipping.** Backend core is real and verified. The two headline risks (SSOT erosion, canvas clobber) are closed structurally and tested. Advance to **Sprint 2 (MCP + portability)**, which reuses this exact service layer behind MCP tools — the payoff of the discipline enforced here.

## Risk-register check (WBS §5)

- *SSOT erosion* — closed: structural (service-only writes) + live tests.
- *Canvas clobber* — closed: §4.7 layout-only, live regression green.
- *MCP write doesn't emit SSE* — pre-mitigated: emit is in-service; S2 MCP tools call the same services.
- *SSE latency >500 ms* — n/a: synchronous in-process bus.

## API surface delivered (for S2/S3 reference)

`GET/POST /projects`, `GET /projects/:id` (+summary), `GET /projects/:id/tasks` (status filter), `PATCH /tasks/:id`, `GET/PUT /projects/:id/canvas` (layout-only), `GET/POST /projects/:id/documents`, `GET/PATCH /documents/:id`, `GET /tasks/:id/document`, `GET /api/v1/events` (SSE). All snake_case + ISO. Services: project/task/canvas/document, each accepting `{db, eventBus}`.
