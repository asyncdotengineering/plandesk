# Sprint 2 Review (Phase B) — MCP + portability

**Reviewer:** Manager (Opus 4.8), 2026-06-07
**Scope:** `b89aee3`, `75e1261`, `bb5a34e`, `1d8bbcd`, `ff9ffea` on `main`
**Sprint goal:** Claude/Codex connect to `/mcp/` with a hashed token, list ≥8 tools, `update_task` → REST GET + SSE, and export→import losslessly via CLI.

## Verdict: **SOLID — shipping.** Goal met; the full feature-parity agent loop works end-to-end over MCP.

## Layer 1 — What works (grounded, live-verified)

- **MCP server is real and standards-correct.** `@modelcontextprotocol/sdk@1.29.0` + `WebStandardStreamableHTTPServerTransport`, mounted in the Hono app at `/mcp/` (both with and without trailing slash after the fix). Live JSON-RPC: initialize handshake, `tools/list` = **10**, `tools/call` against every tool.
- **The agent loop closes.** Live: MCP `create_task` → `update_task {done}` → REST `GET /tasks` shows `done` → SSE `task_updated` fired. `create_edge`, full agent-run lifecycle (start/record/complete), invalid-status rejection — all verified. This is exactly the MCP writeback pattern, on local-first infra.
- **One write path, inherited SSE.** MCP tools call the api services; emits live only in services; mcp imports only the `InvalidTaskStatusError` class + status enum. The Sprint-1 discipline paid off — zero MCP-specific event wiring.
- **Token security per RFC §10.** sha256 at rest, raw shown once (CLI), verify rejects revoked → 401. No raw token in logs.
- **Lossless portability.** Live round-trip: counts + content + links + parent nesting + edge labels preserved under full ID remap; bad version rejected; transactional import. Clears the RFC §11 export/import abort condition.
- **CLI complete.** init/serve/token/export/import/doctor; correct exit codes (1 not-found, 2 corrupt-DB intent). `doctor` reports real state.
- **Architecture stayed clean.** No api↔mcp cycle (api injects the mcp app; cli composes). 137 backend tests (db 40, api 63, mcp 8, cli 26).

## Layer 2 — Blockers / majors

**None blocking.** One manager fix this sprint:

- **`/mcp/` trailing-slash 404** (`75e1261`): the mount handled only `/mcp`; RFC §4.3 + `claude mcp add` use `/mcp/`. Fixed to `app.all('*')`; both forms now reach the transport. Live-verified.

Notes (not debt):
- MCP tool results return both `content[0].text` (JSON string) and `structuredContent` — modern, correct; consumers can use either.
- Agent-run events are emitted but no `GET /agent-runs` REST surface yet — the **UI (S4-03)** consumes them via SSE; add a REST list there if the panel needs history-on-load.

## Layer 3 — Verdict

**SOLID — shipping.** The complete local-first backend is done: REST + SSE + MCP (read+write, agent runs) + portable export/import + CLI. An external Claude/Codex client can drive a Plan Desk project as a live brief today. Advance to **Sprint 3 (web UI)** — the canvas/docs frontend on this verified API.

## Risk-register check (WBS §5)

- *api↔mcp cycle* — avoided (injection seam).
- *MCP SDK transport churn* — handled: live SDK docs, pinned 1.29.0, Web-standard transport, contract exercised live.
- *Second write path / missing SSE* — closed: tools→services; `test:mcp_update_task` green.
- *Token leak* — sha256 only; verified no raw in logs.
- *Export/import data loss (RFC §11 abort)* — closed: lossless round-trip live.

## Agent-facing surface delivered (for S3/S5 reference)

MCP `/mcp/` (Bearer `plandesk_mcp_*`): list_projects, get_project, create_task, update_task, create_document, update_document, create_edge, start_agent_run, record_agent_progress, complete_agent_run. CLI: init, serve, token create, export, import, doctor. Export format: `plandesk-export-v1`.
