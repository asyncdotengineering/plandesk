---
title: REST + MCP API
description: REST endpoints and MCP tools exposed by Plan Desk v1.
---

## REST API (v1)

**Base:** `http://127.0.0.1:3847/api/v1`

**Auth:** Bearer `plandesk_mcp_*` or session cookie for UI (v1 single-user: optional password via env)

| Method | Path                      | Purpose                                     |
| ------ | ------------------------- | ------------------------------------------- |
| GET    | `/health`                 | Health check `{ ok: true }`                 |
| GET    | `/projects`               | List projects                               |
| POST   | `/projects`               | Create project `{ name, description? }`     |
| GET    | `/projects/:id`           | Project detail + summary counts             |
| GET    | `/projects/:id/canvas`    | `{ nodes, edges, layout }`                  |
| PUT    | `/projects/:id/canvas`    | Upsert nodes, edges, layout                 |
| GET    | `/projects/:id/documents` | Document tree                               |
| POST   | `/projects/:id/documents` | Create doc `{ title, body, linkedNodeId? }` |
| GET    | `/documents/:id`          | Document body                               |
| PATCH  | `/documents/:id`          | Update title/body/status                    |
| GET    | `/projects/:id/tasks`     | Task list (filter query params)             |
| PATCH  | `/tasks/:id`              | Update status, label, description, position |
| GET    | `/events`                 | SSE stream                                  |
| POST   | `/agent-runs`             | Start run `{ projectId, label? }`           |
| PATCH  | `/agent-runs/:id`         | Append progress / complete                  |

## MCP server

**Endpoint:** `http://127.0.0.1:3847/mcp/` (Streamable HTTP transport)

**Auth header:** `Authorization: Bearer plandesk_mcp_...`

### Tools (v1)

| Tool                    | Purpose                              |
| ----------------------- | ------------------------------------ |
| `list_projects`         | List accessible projects             |
| `get_project`           | Tasks, docs summary, canvas snapshot |
| `create_task`           | Add canvas node + task row           |
| `update_task`           | Status, label, description, position |
| `create_document`       | Markdown body; optional link to task |
| `update_document`       | Patch title/body/status line         |
| `create_edge`           | Labeled dependency between tasks     |
| `start_agent_run`       | Begin external agent session         |
| `record_agent_progress` | Append progress event                |
| `complete_agent_run`    | Close run (completed or failed)      |

At session start, list tools before calling them. Resolve the project from `.plandesk/config.json` when present — do not guess IDs.

### Error cases

- Unknown project → tool error `not_found`
- Invalid status enum → `invalid_argument`
- Token revoked → HTTP 401

## Factory Desk

Programmatic access without Claude/Codex: install `@plandesk/mcp-client` from npm (or use `packages/plandesk-mcp-client` from a cloned repo) with `PLANDESK_URL` and `PLANDESK_MCP_TOKEN`.
