# Validation contract (RFC §9)

Plan Desk ships a named validation suite aligned with `../plandesk-rfc/04-tasks-validation.md` §9.

## Fail-to-pass tests (`pnpm test`)

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

## Regression tests (`pnpm test`)

| Behavior                                       | Test location                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Drizzle migration up/down on empty DB          | `packages/plandesk-db/src/migrate.test.ts`                                                    |
| Drizzle migration up/down on seeded DB         | `packages/plandesk-db/src/migrate.test.ts`                                                    |
| MCP token revoke → subsequent call returns 401 | `packages/plandesk-api/src/routes/tokens.test.ts`, `packages/plandesk-mcp/src/server.test.ts` |

## Live validation commands (`pnpm validate`)

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
