# Proceed Evidence — S1-03 REST documents (C5)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `aa0e9f1` `[S1-03] REST documents` (cursor)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S1-03)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `test:doc_link` — linked doc resolves via GET /tasks/:id/document | ✅ live: returned "Spec: checkout" |
| 2 | Cross-project link → 400 | ✅ live: doc in B → task of A → 400 |
| 3 | Tree reflects parent_id nesting | ✅ (api tests) |
| 4 | Behavioral tests happy+failure | ✅ db 25, api 49 |

## Independent verification (manager-run, LIVE)

- Created doc in project A linked to task `t1` with `status_line` → response `linked_task_id:"t1"`, ISO `created_at`.
- `GET /tasks/t1/document` → the linked doc.
- Cross-project link (doc in B → t1 of A) → **400**.
- SSOT: documents route has **no** `@plandesk/db` import — writes go through `documentService`.
- Gates: build 6/6, db 25, api 49, lint+Prettier clean. No strays/leaks. snake_case + ISO confirmed.

→ Proceed to **S1-04 (SSE event bus)** — the last story; its in-service emit makes MCP writes broadcast for free in Sprint 2.
