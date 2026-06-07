# Sprint 2 — Plan

**Sprint name:** MCP + portability
**Sprint goal:** Claude/Codex can connect to `/mcp/` with a hashed bearer token, list ≥8 tools, `update_task` and see it in REST GET + SSE, and a project exports→imports losslessly via the CLI.
**Sprint window:** 2026-06-07 → (1w)
**Author:** Opus 4.8 (1M), 2026-06-07

## 1. Stories

### `S2-01` — MCP server + token auth + read tools (C7)
**Description:** Token storage (sha256) + Streamable-HTTP MCP server at `/mcp/` reusing the api service layer (one bus). Read tools `list_projects`, `get_project`. Declare the full ≥8-tool set (write tools land in S2-02). Wiring must avoid an api↔mcp cycle: api injects the mcp app; mcp depends on api service types.
**Acceptance:** `mcp_tokens` repo (create→raw once + sha256, verify, list, revoke); MCP session over Streamable HTTP lists ≥8 tools; valid token auth; revoked/absent → 401; `list_projects`/`get_project` return snake_case shapes.

### `S2-02` — MCP write tools (C8)
**Description:** `create_task`, `update_task`, `create_document`, `update_document`, `create_edge`, `start_agent_run`, `record_agent_progress`, `complete_agent_run` as thin adapters over the **same services** (no second write path). No delete tool. Agent-run service + SSE emits added here.
**Acceptance:** `test:mcp_update_task` (MCP update → REST GET reflects → SSE `task_updated`); unknown project → `not_found`; invalid status → `invalid_argument`.

### `S2-03` — Export / import (C9)
**Description:** `export_project` → `plandesk-export-v1` JSON (project, tasks, edges, documents, agent_runs); `import_project` validates version, remaps IDs in a transaction.
**Acceptance:** `test:export_import` — export A → import B → node/edge/doc counts + content deep-equal; edges + doc links preserved.

### `S2-04` — CLI complete (C10)
**Description:** `plandesk export --project --out`, `import --in`, `token create --name`, `doctor`. Corrupt DB → exit 2 suggest doctor.
**Acceptance:** each works end-to-end; `token create` prints raw once + stores hash; `doctor` reports DB+migration health.

## 2. Universal DoD (per story)
- [ ] build+test+lint green; happy+failure tests per surface.
- [ ] MCP tools call the api services, never the db directly (SSOT/SSE).
- [ ] Token: store sha256 only; raw shown once; no raw token in logs.
- [ ] No stubs/`@ts-ignore`/scratch files; atomic `[S2-NN]` commit.

## 3. Test plan
| Story | Test |
|-------|------|
| S2-01 | token repo happy/failure; MCP list_tools ≥8; 401 on bad token |
| S2-02 | mcp update_task → REST + SSE; not_found/invalid_argument |
| S2-03 | export/import deep-equal roundtrip incl edges+links |
| S2-04 | CLI export/import/token/doctor end-to-end |

## 4. Demo
MCP inspector: connect with created token → list_tools (≥8) → get_project → update_task → REST GET shows new status + SSE fired. CLI export→import deep-equal.

## 5. Risks
| Risk | Detection | Mitigation |
|------|-----------|------------|
| api↔mcp circular dep | build fails / cycle | api injects mcp app (callback seam); mcp imports api types one-way; CLI composes. |
| MCP SDK Streamable-HTTP API churn | transport wiring fails | fetch live SDK docs (Context7) before wiring; pin latest; lock transport in a test. |
| Second write path in MCP (skips SSE) | MCP write doesn't emit SSE | tools call services; assert SSE in test:mcp_update_task. |
| Token leak in logs | grep | log hash/prefix only. |

## 6. Open questions
- MCP mounted inside the api Hono app at `/mcp` (RFC §7.1) sharing services+bus — confirmed approach. Streamable HTTP transport adapted to Hono request/response; worker fetches live SDK docs first.
