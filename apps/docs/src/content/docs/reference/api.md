---
title: REST + MCP API
description: REST endpoints and MCP tools exposed by Plan Desk v1.
---

## REST API (v1)

**Base:** `http://127.0.0.1:3847/api/v1`

**Auth:** Bearer `plandesk_mcp_*` or session cookie for UI (v1 single-user: optional password via env)

| Method | Path                          | Purpose                                     |
| ------ | ----------------------------- | ------------------------------------------- |
| GET    | `/health`                     | Health check `{ ok: true }`                 |
| GET    | `/projects`                   | List projects                               |
| POST   | `/projects`                   | Create project `{ name, description? }`     |
| GET    | `/projects/:id`               | Project detail + summary counts             |
| GET    | `/projects/:id/canvas`        | `{ nodes, edges, layout }`                  |
| PUT    | `/projects/:id/canvas`        | Upsert nodes, edges, layout                 |
| PATCH  | `/projects/:id`               | Rename / update `{ name?, description? }`   |
| DELETE | `/projects/:id`               | Delete project (cascades children)          |
| GET    | `/projects/:id/documents`     | Document tree                               |
| POST   | `/projects/:id/documents`     | Create doc `{ title, body, linkedNodeId? }` |
| GET    | `/documents/:id`              | Document body                               |
| PATCH  | `/documents/:id`              | Update title/body/status                    |
| DELETE | `/documents/:id`              | Delete document                             |
| GET    | `/projects/:id/tasks`         | Task list (filter query params)             |
| POST   | `/projects/:id/tasks`         | Create task `{ label, status?, … }`         |
| PATCH  | `/tasks/:id`                  | Update status, label, description, position |
| DELETE | `/tasks/:id`                  | Delete task (cascades edges, unlinks docs)  |
| DELETE | `/projects/:id/edges/:edgeId` | Delete a dependency edge                    |
| POST   | `/documents/:id/comments`     | Add comment `{ body, passage? }`            |
| GET    | `/documents/:id/comments`     | Comments for a document                     |
| GET    | `/projects/:id/comments`      | Comments across a project                   |
| PATCH  | `/comments/:id`               | Edit / resolve `{ body?, resolved? }`       |
| DELETE | `/comments/:id`               | Delete a comment (UI only)                  |
| GET    | `/events`                     | SSE stream                                  |
| POST   | `/agent-runs`                 | Start run `{ projectId, label? }`           |
| PATCH  | `/agent-runs/:id`             | Append progress / complete                  |

## MCP server

**Endpoint:** `http://127.0.0.1:3847/mcp/` (Streamable HTTP transport)

**Auth header:** `Authorization: Bearer plandesk_mcp_...`

### Tools (v1)

| Tool                         | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `list_projects`              | List accessible projects                             |
| `get_project`                | Tasks, docs summary, canvas snapshot                 |
| `create_project`             | Create a new project                                 |
| `scaffold_project_from_plan` | Create a project + tasks + edges + docs in one call  |
| `get_next_task`              | Next actionable `todo` task (prerequisites all done) |
| `create_task`                | Add canvas node + task row                           |
| `update_task`                | Status, label, description, position                 |
| `create_document`            | Markdown body; optional link to task                 |
| `update_document`            | Patch title/body/status line                         |
| `get_document`               | Fetch a document by id                               |
| `list_documents`             | Project documents as a tree                          |
| `create_edge`                | Labeled dependency between tasks                     |
| `list_comments`              | Open (or all) document comments for a project        |
| `add_comment`                | Leave a comment on a document                        |
| `resolve_comment`            | Mark a comment resolved (no delete tool)             |
| `start_agent_run`            | Begin external agent session                         |
| `record_agent_progress`      | Append progress event                                |
| `complete_agent_run`         | Close run (completed or failed)                      |
| `publish_project`            | Register + first-push a project to a sync server     |
| `sync_push`                  | Push the allow-list projection to shares             |
| `sync_pull`                  | Fetch participant submissions into the triage inbox  |
| `list_submissions`           | List pulled submissions (triage inbox)               |
| `triage_submission`          | Accept a submission → real task (or reject)          |

23 tools in total. The last five are the [collaboration tier](/reference/collaboration/) — sharing a project with a client or team. At session start, list tools before calling them. Resolve the project from `.plandesk/config.json` when present — do not guess IDs. To stand up a whole plan at once use `scaffold_project_from_plan`; to execute it, loop `get_next_task` → `update_task`. There is no delete tool by design — resolve comments rather than deleting them.

### Error cases

- Unknown project → tool error `not_found`
- Invalid status enum → `invalid_argument`
- Token revoked → HTTP 401

## Factory Desk

Programmatic access without Claude/Codex: install `@plandesk/mcp-client` from npm (or use `packages/plandesk-mcp-client` from a cloned repo) with `PLANDESK_URL` and `PLANDESK_MCP_TOKEN`.
