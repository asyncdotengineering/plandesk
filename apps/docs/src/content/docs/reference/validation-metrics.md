---
title: Validation & Metrics
description: Test suite, live validation commands, and v1 performance targets.
---

## Validation contract

Plan Desk ships a named validation suite aligned with the RFC validation section.

### Fail-to-pass tests (`pnpm test`)

| Assertion ID                 | Behavior                                                             | Test location                                        |
| ---------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| `test:canvas_roundtrip`      | PUT 3 nodes + 2 labeled edges; GET returns identical coords + labels | `packages/plandesk-api/src/routes/canvas.test.ts`    |
| `test:doc_link`              | Create doc with `linkedTaskId`; GET `/tasks/:id/document` returns it | `packages/plandesk-api/src/routes/documents.test.ts` |
| `test:sse_task_update`       | SSE client receives `task_updated` within 500 ms of PATCH            | `packages/plandesk-api/src/routes/events.test.ts`    |
| `test:mcp_update_task`       | MCP `update_task` → REST reflects change → SSE fires                 | `packages/plandesk-mcp/src/server.test.ts`           |
| `test:export_import`         | Export → import → node/edge/doc counts + content match               | `packages/plandesk-db/src/portability.test.ts`       |
| `test:factory_adapter_smoke` | MCP client with token lists ≥1 project on live server                | `packages/plandesk-mcp-client/src/client.test.ts`    |

Discover any named assertion:

```bash
pnpm test 2>&1 | rg 'test:(canvas_roundtrip|doc_link|sse_task_update|mcp_update_task|export_import|factory_adapter_smoke)'
```

### Regression tests (`pnpm test`)

| Behavior                                       | Test location                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Drizzle migration up/down on empty DB          | `packages/plandesk-db/src/migrate.test.ts`                                                    |
| Drizzle migration up/down on seeded DB         | `packages/plandesk-db/src/migrate.test.ts`                                                    |
| MCP token revoke → subsequent call returns 401 | `packages/plandesk-api/src/routes/tokens.test.ts`, `packages/plandesk-mcp/src/server.test.ts` |

### Live validation commands (`pnpm validate`)

`scripts/validate.sh` boots `plandesk serve` on a temp data directory and ephemeral port, then runs:

| Assertion ID         | Check                                          |
| -------------------- | ---------------------------------------------- |
| `cmd:api_health`     | `GET /api/v1/health` → `{ "ok": true }`        |
| `cmd:plandesk_serve` | Server responds on the chosen loopback port    |
| `cmd:mcp_list_tools` | MCP session lists ≥8 tools with a bearer token |

The script traps `EXIT`/`INT`/`TERM` and reaps the server process plus temp directory. It never touches `~/.plandesk`.

```bash
pnpm validate
# equivalent:
bash scripts/validate.sh
```

Run the full gate before shipping:

```bash
pnpm build && pnpm test && pnpm lint && pnpm validate
```

## v1 Metrics

Performance targets are measured with `pnpm metrics` (`node scripts/metrics.mjs`).

**Measured:** 2026-06-07 — darwin arm64, Apple M1 Pro, Node v22.22.2

| Metric                                            | Target   | Measured                        | Status |
| ------------------------------------------------- | -------- | ------------------------------- | ------ |
| Cold start (serve spawn → first `POST /projects`) | < 5 s    | 419.9 ms (0.42 s)               | PASS   |
| MCP `list_projects` + `get_project` p50           | —        | 2.6 ms                          | —      |
| MCP `list_projects` + `get_project` p95           | < 2 s    | 4.9 ms                          | PASS   |
| SSE `task_updated` latency p50 (PATCH → event)    | —        | 1.3 ms                          | —      |
| SSE `task_updated` latency p95                    | < 500 ms | 1.9 ms                          | PASS   |
| Export/import lossless (counts + links)           | lossless | true (tasks=3, edges=2, docs=2) | PASS   |

### Measurement rig

- Isolated temp data dir + ephemeral loopback port; `plandesk init` before serve.
- Cold start: fresh `plandesk serve` spawn until first successful `POST /api/v1/projects`.
- MCP: Bearer token; 50 sequential `list_projects` + `get_project` pairs via Streamable HTTP MCP.
- SSE: one `/api/v1/events` subscriber; 20 `PATCH /api/v1/tasks/:id` toggles; time to `task_updated`.
- Export/import: REST fixture → CLI export → import → re-export; compare structure without IDs.
