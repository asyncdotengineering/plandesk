# Sprint 2 Warm-down — MCP + portability

**Closed:** 2026-06-07 · **Status:** ✅ complete · **Build branch:** `main`

## What shipped

The complete local-first backend: an MCP server (read+write) on the same service layer as REST, plus portable export/import and a full CLI.

| Story | Commit | Delivers |
|-------|--------|----------|
| S2-01 | `b89aee3` + `75e1261` | MCP server (`/mcp/` Streamable HTTP), sha256 token auth, read tools |
| S2-02 | `bb5a34e` | 10 MCP tools (8 write) via services; agent-run service + `agent_run_*` SSE |
| S2-03 | `1d8bbcd` | lossless `plandesk-export-v1` export/import (ID remap, transactional) |
| S2-04 | `ff9ffea` | CLI export/import/doctor (+ existing init/serve/token) |

## What's working (live-verified)

- MCP: initialize + `tools/list`=10 + every tool callable with a Bearer token; 401 on bad/missing token.
- **Agent loop:** MCP `update_task` → REST GET reflects → SSE `task_updated`. create_edge + agent-run lifecycle.
- Export→import lossless (counts/content/links/nesting under new IDs); bad version rejected.
- CLI: `export`/`import`/`doctor` with correct exit codes.
- 137 backend tests (db 40, api 63, mcp 8, cli 26); `pnpm build && pnpm test && pnpm lint` green.

## What's NOT done (later sprints)

- **No web UI behavior yet** → Sprints 3 (shell+canvas+docs) & 4 (board+settings+agent-runs panel).
- No `GET /agent-runs` REST list — agent-run UI (S4-03) consumes SSE; add a REST list there if history-on-load is needed.
- No `plandesk connect`/`.plandesk/` → Sprint 5.

## Decisions / conventions (carry forward)

- **MCP tool results** return `content[0].text` (JSON) + `structuredContent` (snake_case + ISO via `serialize.ts`). Web client (S3) consumes the same REST shapes.
- **One write path:** services own mutations + SSE; MCP + REST both call them. **Do not add a second write path anywhere.**
- **Token:** sha256 at rest, raw once. `claude mcp add --transport http <url>/mcp/ --header "Authorization: Bearer plandesk_mcp_…"` is the connect form (S5 `plandesk connect` automates this).
- **Architecture seam:** api injects the mcp app (no api↔mcp cycle); CLI composes services + mcpApp + createApp.
- Export format `plandesk-export-v1` is the dogfood fixture format (S5-04).

## Open issues / RFC amendments

- Carried from S1: additive `projects.canvas_layout` column (note into RFC §4.4 at S5 doc pass).
- Standing: §4.7 `plandesk connect` lands in Sprint 5 (+ fold C17 reference, supersede §7.4 skill stub).
- No blockers. Backend feature-complete for v1.
