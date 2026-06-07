# Proceed Evidence — S6-01 Validation suite (§9)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `8ff2236` `[S6-01] Validation suite` (cursor)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S6-01)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Each §9.1 `test:*` id in a passing test | ✅ all 6 wired (below) |
| 2 | Regression: migrate up/down (empty+seeded); revoke→401 | ✅ in db/api tests |
| 3 | `scripts/validate.sh` runs §9.3 commands green + reaps server | ✅ live (below) |
| 4 | `pnpm test` green | ✅ 12/12 tasks |

## Independent verification (manager-run)

- Named §9 assertions present + green:
  - `test:canvas_roundtrip` → `routes/canvas.test.ts`
  - `test:doc_link` → `routes/documents.test.ts`
  - `test:sse_task_update` → `routes/events.test.ts`
  - `test:mcp_update_task` → `mcp/server.test.ts`
  - `test:export_import` → `db/portability.test.ts`
  - `test:factory_adapter_smoke` → `mcp-client/client.test.ts`
- **`bash scripts/validate.sh`** → `cmd:api_health OK`, `cmd:plandesk_serve OK`, MCP tools: **10** → `cmd:mcp_list_tools OK`, "all checks passed", exit 0. Server reaped (no listener leak before/after).
- Gates: build 6/6, full 12/12, lint clean. No strays/leaks.

→ Proceed to **S6-02 (Metrics gate)**.
