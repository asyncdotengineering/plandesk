# Proceed Evidence — S2-02 MCP write tools (C8)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `bb5a34e` `[S2-02] MCP write tools` (cursor)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S2-02)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | 8 write tools registered + via services; tools/list ≥8 | ✅ **10 tools** live (2 read + 8 write) |
| 2 | `test:mcp_update_task`: MCP update → REST reflects → SSE | ✅ **live-proven** (below) |
| 3 | agent-run repos + service emit `agent_run_*` | ✅ start/record/complete lifecycle live |
| 4 | unknown → not_found; invalid status → invalid_argument | ✅ invalid status rejected live |
| 5 | no delete tool; no second write path; emits in services | ✅ no emit in mcp; tools call services |

## Independent verification (manager-run, LIVE MCP write session)

Against a real served instance (token via CLI, `/mcp/` Streamable HTTP):
- `tools/list` → **10**: list_projects, get_project, create_task, update_task, create_document, update_document, create_edge, start_agent_run, record_agent_progress, complete_agent_run.
- `create_task` → returns `{task:{…}}` (snake_case + ISO) in both `content[0].text` and `structuredContent`.
- **`test:mcp_update_task`**: open SSE → MCP `update_task {status:done}` → `GET /projects/:id/tasks` shows `status: done` → SSE stream received `task_updated`. **Full chain: MCP → service → db → REST + SSE.**
- `create_edge` (blocks) ✓; agent-run `start → record_progress → complete` ✓.
- `update_task {status:bogus}` → rejected (isError/jsonrpc error).
- SSOT: mcp tools import only `InvalidTaskStatusError` + status enum (validation), never db writes. Emits only in services.
- Gates: build 6/6, db 36, api 63, mcp 8, lint+Prettier clean. No strays/leaks.

## Why this matters

This closes the feature-parity agent loop: an external Claude/Codex MCP client can read the plan, create/update tasks, draw labeled dependency edges, and record agent-run progress — every write going through the single service layer, reflected in REST and broadcast to the UI via SSE with zero MCP-specific event wiring. The Sprint-1 "emit inside services" decision paid off exactly as designed.

→ Proceed to **S2-03 (export/import)**.
