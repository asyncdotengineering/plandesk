# Proceed Evidence — S2-03 Export / import (C9)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `1d8bbcd` `[S2-03] Export / import` (cursor)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S2-03)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `exportProject` full `plandesk-export-v1`; unknown → undefined | ✅ |
| 2 | `importProject` version-validated, ID-remapped, transactional, returns new id | ✅ |
| 3 | `test:export_import` round-trip deep-equal (counts + content + links) | ✅ **live PASS:true** |
| 4 | Bad version → clear error | ✅ "Unsupported export version: wrong" |

## Independent verification (manager-run, LIVE round-trip)

Built a project (2 tasks incl. `in_progress`, 1 `blocks` edge, parent doc + child doc with `parent_id` + `linked_task_id` + status_line) → `exportProject` → `importProject` → compared:
- counts: tasks [2,2], edges [1,1], docs [2,2] ✓
- `linkOk` (linked_task_id resolves to a NEW task id) ✓
- `parentOk` (parent_id nesting preserved under new ids) ✓
- `edgeOk` (edge from/to remapped, label `blocks` preserved) ✓
- `idsRemapped` (new project id ≠ old; old task ids not reused) ✓
- **PASS: true**
- Bad version → throws clear error.
- Gates: build 6/6, db 40 tests, lint+Prettier clean. No strays/leaks.

This clears the RFC §11 abort condition ("export/import loses edges or doc links"). Lossless under full ID remap.

→ Proceed to **S2-04 (CLI complete)** — last story of Sprint 2.
