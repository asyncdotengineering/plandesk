# Proceed Evidence — S2-01 MCP server + token auth + read tools (C7)

**Verdict:** `PROCEED`
**IC commit:** `b89aee3` `[S2-01]` (cursor)
**Manager fix:** `75e1261` `[S2-01-fix]` (trailing-slash `/mcp/` routing)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S2-01)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `mcp_tokens` repo: create(raw once+sha256), verify(reject revoked), list, revoke | ✅ `createHash('sha256')`; verify filters `revoked_at IS NULL`; db 31 tests |
| 2 | createServices extracted; one bus REST+MCP; no api↔mcp cycle | ✅ `createServices` in api; serve composes; api does NOT import mcp |
| 3 | MCP at `/mcp/` Streamable HTTP; bearer auth; 401 | ✅ live: no/bad token → 401; **`/mcp/` + `/mcp` → 200** (after fix) |
| 4 | list_projects + get_project via services, snake_case | ✅ live tools/call returned real project |
| 5 | MCP session connects with token, calls read tools | ✅ full JSON-RPC handshake + tools/list + tools/call |

## Independent verification (manager-run, LIVE MCP session)

- CLI `token create` → `plandesk_mcp_…` (56 chars), stored sha256.
- `POST /mcp/` with no token → 401; bad token → 401; **valid token → 200** initialize (`serverInfo: plandesk 1.0.0`, `capabilities.tools`).
- `tools/list` → `list_projects`, `get_project` (2 implemented; ≥8 completes in S2-02 — registry already declares all 10 schemas, no throwing stubs).
- `tools/call get_project {project_id}` → returned "Checkout Revamp" via `projectService` (service layer, not db).
- Architecture: `McpServer` + `WebStandardStreamableHTTPServerTransport` (Web-standard Request/Response, ideal for Hono `c.req.raw`), stateless. SDK `@modelcontextprotocol/sdk@1.29.0` (latest). zod 3.25.76.
- Gates: build 6/6, db 31, api 55, mcp 4, lint+Prettier clean. No strays/leaks/throwing-stubs.

## Manager fix

- **`/mcp/` trailing-slash 404** → changed mount handler `app.all('/')` → `app.all('*')`. RFC §4.3 documents `/mcp/`; clients using the documented URL (and `claude mcp add`) hit it. Now both `/mcp` and `/mcp/` reach the transport; auth unchanged. Live-verified + tests green.

## Notes for S2-02

- `registry.ts` already exports `v1ToolNames` (10) + `v1ToolSchemas` (zod) — S2-02 registers the 8 write tools with real handlers calling services. The ≥8 `cmd:mcp_list_tools` assertion lands when S2-02 closes.
- Write tools must call `services.*` (taskService/canvasService/documentService + a new agentRunService) so SSE broadcasts for free. Agent-run service + `agent_run_*` emits are added in S2-02.
- `TokenStore.verify` is the seam the MCP app uses; back it with the tokens repo.

→ Proceed to **S2-02 (MCP write tools)**.
