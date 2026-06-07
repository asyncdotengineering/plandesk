# Proceed Evidence — S5-04 Dogfood project (C20)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `435cac3` `[S5-04] Dogfood project` (cursor)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S5-04)

| # | Criterion | Result (live) |
|---|-----------|---------------|
| 1 | Valid `plandesk-export-v1`; imports cleanly | ✅ CLI import → new project id |
| 2 | Realistic plan (≥6 tasks, ≥4 edges, ≥2 linked docs) | ✅ 8 tasks, 6 edges, 3 docs |
| 3 | Fixture test imports + asserts | ✅ db test suite |
| 4 | MCP get_project returns case-study shape | ✅ MCP → "Checkout Revamp", `structuredContent.project` |

## Independent verification (manager-run, LIVE)

- `plandesk import --in examples/checkout-revamp.json` → project id.
- REST `GET /projects/:id` → "Checkout Revamp", summary `{scope:2, todo:3, in_progress:1, done:1, backlog:1}` (all 5 statuses, 8 tasks).
- Canvas → 8 nodes, 6 edges, sample edge label `blocks` (labeled deps preserved). Edge labels: blocks/depends_on/feeds/clarifies/enables.
- MCP `get_project` → returns the project shape.
- Gates: build 6/6, full 12/12, lint clean. No strays/leaks. `examples/{checkout-revamp.json,README.md}`.

→ Sprint 5 stories all PROCEED. Advance to **Phase B (sprint review)**.
