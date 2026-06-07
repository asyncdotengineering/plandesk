# Proceed Evidence — S1-02 REST canvas + edges, layout-only PUT (C4, §4.7)

**Verdict:** `PROCEED` (no manager fix)
**IC commit:** `be02b00` `[S1-02] REST canvas + edges (layout-only PUT)` (cursor)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S1-02)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `test:canvas_roundtrip` (3 nodes + 2 labeled edges) | ✅ in api tests (35 pass) |
| 2 | **Concurrency regression — layout PUT can't clobber status** | ✅ **live-verified** (see below) |
| 3 | New node via PUT creates task (label, todo); existing updates only x/y | ✅ `updateTask(tx,id,{x,y})` only |
| 4 | Edge reconcile (create/update/delete); edge→missing task = 400 | ✅ transaction-wrapped reconcile + validation |
| 5 | GET canvas `{nodes,edges,layout}` snake_case | ✅ `serializeEdge` (`from_task_id`/`to_task_id`/`arrow_direction`) |

## Independent verification (manager-run, LIVE)

The §4.7 clobber regression, run against the real server:
1. New node `task-1` via canvas PUT → `PATCH /tasks/task-1 {status:"in_progress"}` → status `in_progress`.
2. `PUT /canvas` with `task-1` carrying **stale `status:"todo"`** + new coords (99,88).
3. GET canvas → `{status:"in_progress", x:99, y:88, PASS:true}`.

**The layout PUT updated position but could not change status.** This is exactly the bug §4.7 exists to prevent, proven prevented.

- Code path confirmed: for an existing node the service calls `updateTask(tx, node.id, { x, y })` — only x/y; status/label/description never passed. New nodes require a label, default `todo`. Multi-row upsert + edge reconcile in a `db.transaction`.
- Gates: `pnpm build` 6/6, `pnpm test` (db 19, api 35), `pnpm lint` + Prettier clean. No strays/leaks.

## Design decision noted (intentional, not a defect)

- `CanvasNodeInput.status?` is **accepted-and-ignored**, not rejected. This is the robust choice: a UI/agent that round-trips a whole node (incl. its known status) won't get a 400, and its stale status still can't clobber. The §4.7 guarantee holds either way; ignoring is friendlier than rejecting. Documented so it's understood as deliberate.

## RFC delta to track (minor, additive)

- **Schema:** migration `0001` adds `projects.canvas_layout text` to persist the documented canvas `layout` field (RFC §4.2 GET/PUT canvas return/accept `layout`; §4.4 didn't list the column). Additive, backward-compatible. → fold into the RFC §4.4 data-model note at Sprint close or S5.

→ Proceed to **S1-03 (REST documents)**.
