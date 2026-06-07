# Sprint 1 — Plan

**Sprint name:** Backend core (REST + SSE)
**Sprint goal (one sentence):** A client can CRUD projects/tasks, round-trip a canvas of nodes + labeled edges, link a document to a task, and receive an SSE `task_updated` within 500 ms of a PATCH — all through one service layer that is the single SSOT.
**Sprint window:** 2026-06-07 → (1w)
**Author (main session):** Opus 4.8 (1M), 2026-06-07

---

## 1. Stories

### `S1-01` — REST projects + tasks via service layer (C3)

**Description:** Build the REST surface for projects and tasks on the Hono app, behind a **service layer** (`projectService`, `taskService` in `@plandesk/api`) that is the single write path. Routes are thin; services own validation + mutation (+ SSE emit, wired in S1-04). Status enum enforced. This service layer is what MCP reuses in Sprint 2 — get it right.

**Acceptance criteria:**
1. `POST /api/v1/projects {name, description?}` → 201 + project; `GET /api/v1/projects`; `GET /api/v1/projects/:id` (404 if missing) with summary counts.
2. `GET /api/v1/projects/:id/tasks` (filter query params honored); `PATCH /api/v1/tasks/:id` updates status/label/description/position.
3. Invalid status enum → 400 `{error:"invalid_argument"}`; unknown id → 404 `{error:"not_found"}`.
4. **All mutations go through the service layer** — no route handler imports the db client/repositories directly (enforced by structure; note it in the review).
5. `updated_at` bumps on task update; timestamps serialized as ISO in JSON.
6. Behavioral tests: happy + failure path per endpoint (via `app.request`).

**Files:** `packages/plandesk-api/src/services/{projects,tasks}.ts`, `routes/{projects,tasks}.ts`, wire into `server.ts`; `@plandesk/db` repos extended as needed; `*.test.ts`.

**Demo artifact:** `sprints/sprint-1/artifacts/s1-01-rest.txt` — curl CRUD transcript.

### `S1-02` — REST canvas + edges, layout-only PUT (C4, §4.7 fix)

**Description:** `GET /projects/:id/canvas → {nodes, edges, layout}` and `PUT /projects/:id/canvas`. Per RFC §4.7, the **PUT persists layout only** (node x/y + edges); task semantic fields (status/label/description) are NEVER written by the canvas PUT — they go through `PATCH /tasks/:id` (S1-01). Edge create/update with labels (§5.3 enum, free-text allowed). This prevents a debounced UI layout save from clobbering a concurrent agent status write.

**Acceptance criteria:**
1. `test:canvas_roundtrip`: PUT 3 nodes + 2 labeled edges → GET returns identical coordinates + labels.
2. **Concurrency regression test:** PATCH a task to `in_progress`, then PUT canvas (layout) built from stale node data → the task's status is still `in_progress` (layout PUT did not touch status).
3. Edges persist `from/to/label/arrow_direction/style`; edge label free-text allowed, enum suggested.
4. Behavioral tests happy + failure (e.g. edge referencing a non-existent task → 400).

**Files:** `packages/plandesk-api/src/services/canvas.ts`, `routes/canvas.ts`, `@plandesk/db` edges repo; `*.test.ts`.

**Demo artifact:** `sprints/sprint-1/artifacts/s1-02-canvas.txt`.

### `S1-03` — REST documents (C5)

**Description:** Document tree + linking. `POST /projects/:id/documents {title, body, linkedNodeId?}`, `GET /projects/:id/documents` (tree), `GET /documents/:id`, `PATCH /documents/:id` (title/body/status), `GET /tasks/:id/document`. Markdown/JSON-AST body + `status_line`.

**Acceptance criteria:**
1. `test:doc_link`: create doc with `linkedTaskId` → `GET /tasks/:id/document` returns it.
2. Document must belong to the project; cross-project link → 400.
3. Tree reflects `parent_id` nesting.
4. Behavioral tests happy + failure.

**Files:** `packages/plandesk-api/src/services/documents.ts`, `routes/documents.ts`, `@plandesk/db` documents repo; `*.test.ts`.

**Demo artifact:** `sprints/sprint-1/artifacts/s1-03-docs.txt`.

### `S1-04` — SSE event bus (C6)

**Description:** `GET /api/v1/events` via Hono `streamSSE`; an in-process `eventBus` emitted **inside the service layer** so every mutation (REST now, MCP in S2) broadcasts. Event types: `task_updated`, `canvas_updated`, `document_created`, `agent_run_*`. Unsubscribe on disconnect.

**Acceptance criteria:**
1. `test:sse_task_update`: an `EventSource`/SSE client receives `task_updated` within 500 ms of a `PATCH /tasks/:id`.
2. Disconnect → listener unsubscribed (no leak); abort handled.
3. SSE emit lives in the service layer (so an MCP write in S2 will broadcast with zero extra wiring).
4. Behavioral test for at least one event type end-to-end.

**Files:** `packages/plandesk-api/src/events.ts` (eventBus), `routes/events.ts`, wire emits into services; `*.test.ts`.

**Demo artifact:** `sprints/sprint-1/artifacts/s1-04-sse.txt` — SSE receive transcript with timing.

---

## 2. Universal DoD checklist (per story)

- [ ] `pnpm build && pnpm test && pnpm lint` green.
- [ ] Behavioral coverage: happy + failure path per public surface.
- [ ] Proof JSON written; manager proceed = **PROCEED**.
- [ ] Demo artifact under `sprints/sprint-1/artifacts/`.
- [ ] No stubs/`@ts-ignore`/swallowed errors; **no route touches the db directly** — service layer only.
- [ ] No scratch/notes files committed.
- [ ] Atomic commit `[S1-NN] <title>` on `main`.

## 3. Test plan

| Story | Layer | Test type | Fixtures |
|-------|-------|-----------|----------|
| S1-01 | api | route happy/failure via app.request | temp SQLite |
| S1-02 | api | canvas roundtrip + concurrency regression | temp SQLite |
| S1-03 | api | doc link + cross-project reject | temp SQLite |
| S1-04 | api | SSE receives event < 500 ms | temp SQLite + SSE client |

Not tested this sprint: MCP (S2), UI (S3).

## 4. Demo plan

**Demo:** One curl transcript: create project → create task → open SSE in a second shell → PATCH task status (SSE prints `task_updated` < 500 ms) → PUT canvas with 2 labeled edges → GET canvas matches → create linked doc → GET task document.

## 5. Risks specific to this sprint

| Risk | Detection signal | Mitigation |
|------|------------------|------------|
| A route bypasses the service layer (SSOT erosion) | route imports db client/repo directly | Structural review; services are the only write path; grep in review. |
| Canvas PUT clobbers concurrent status PATCH | concurrency regression test fails | §4.7 layout-only PUT; the S1-02 regression test is the guard. |
| SSE emit placed in routes not services | MCP write in S2 wouldn't broadcast | Emit inside services; assert via test. |
| SSE latency > 500 ms | timing test | In-process synchronous eventBus; no external broker. |

## 6. Open questions

- Body storage format (Markdown vs JSON AST): default to Markdown string for `body` + a `status_line` column (RFC §4.4 already has `status_line`). TipTap in S3 will serialize to/from Markdown. If S3 needs JSON AST, that's an S3 amendment — keep S1 storing the body string faithfully.
