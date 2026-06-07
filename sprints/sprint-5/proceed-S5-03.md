# Proceed Evidence — S5-03 Factory Desk adapter (C19)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `d517101` `[S5-03] Factory Desk adapter` (cursor)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S5-03)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `createPlandeskClient` connects Streamable HTTP + Bearer; list/get/close | ✅ `Client` + `StreamableHTTPClientTransport` |
| 2 | `PLANDESK_URL`/`PLANDESK_MCP_TOKEN` env support | ✅ env-driven |
| 3 | **`test:factory_adapter_smoke`: lists ≥1 project (real server)** | ✅ live: `["checkout-revamp"]`, count 1 |
| 4 | MCP-only coupling, no canvas-state dup (REQ-12) | ✅ `client.ts` imports only the MCP SDK (api/db only in the test, to stand up a server) |

## Independent verification (manager-run, LIVE)

- Spun a real server + created a token + a project; `PLANDESK_URL`/`PLANDESK_MCP_TOKEN` env → `await createPlandeskClient()` → `listProjects()` → `["checkout-revamp"]` (count 1, smoke ✓).
- Bad token → rejected.
- `client.ts` uses `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` only; no `@plandesk/db|api` import in the adapter source (REQ-12). The test legitimately uses api/db to host a server to test against.
- mcp-client test suite cleans up its server (no leak — before/after listener count equal).
- Gates: build 6/6, mcp-client 7 tests, full 12/12, lint clean.
- Note: `createPlandeskClient` is async (awaits transport connect) — consumers must `await` it (two earlier "errors" in my manual smoke were a missing `await`, not a product defect).

→ Proceed to **S5-04 (Dogfood project)** — last story of Sprint 5.
