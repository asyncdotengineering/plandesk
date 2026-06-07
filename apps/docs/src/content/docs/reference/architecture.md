---
title: Architecture
description: Monorepo layout, service-layer SSOT, and real-time SSE.
---

## Monorepo layout

```
apps/plandesk-web/          React SPA (canvas, docs, board, settings)
apps/docs/                  Astro Starlight documentation site
packages/plandesk-api/      Hono REST + SSE
packages/plandesk-db/       SQLite schema + Drizzle migrations
packages/plandesk-mcp/      MCP server (Streamable HTTP, 10 tools)
packages/plandesk-cli/      plandesk binary (init, serve, connect, …)
packages/plandesk-mcp-client/  Factory Desk / programmatic MCP consumer
```

## Published npm packages

Core packages ship under the `@plandesk/*` scope on npm (currently `0.1.1`):

| Package                | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `@plandesk/cli`        | `plandesk` binary; bundles the web UI for `serve` |
| `@plandesk/api`        | Hono REST + SSE server                            |
| `@plandesk/db`         | SQLite schema + migrations                        |
| `@plandesk/mcp`        | MCP server (10 tools)                             |
| `@plandesk/mcp-client` | Programmatic MCP consumer                         |

Install with `npm i -g @plandesk/cli` to run Plan Desk without cloning the repo.

## Service-layer single source of truth

Task status, canvas node positions, and document content all flow through the API/DB layer. The board view and canvas read the same task rows — there is no separate board state.

MCP writes go through the same service layer as REST and broadcast SSE events within 500 ms.

## Real-time updates (SSE)

The UI subscribes to `GET /api/v1/events` for task, canvas, and agent-run changes. MCP tool calls that mutate state trigger the same SSE events as REST PATCH requests.

## Data model

SQLite workspace at `~/.plandesk/workspace.db`:

- `projects` — project metadata
- `tasks` — canvas nodes + board status (`scope` | `todo` | `in_progress` | `done` | `backlog`)
- `edges` — labeled directed dependencies between tasks
- `documents` — markdown bodies with optional `linked_task_id`
- `agent_runs` / `agent_run_events` — external agent session tracking
- `mcp_tokens` — hashed bearer tokens (raw shown once at creation)

## Frontend

- **Stack:** React 19, Vite, TanStack Router, TanStack Query, `@xyflow/react` (canvas), TipTap (docs)
- **Routes:** `/`, `/projects/:id/overview`, `/projects/:id/flow`, `/projects/:id/board`, `/projects/:id/documents/:docId`, `/settings/mcp`
- Served as static SPA assets by the API server in production

## Repo binding

`plandesk connect` writes `<repo>/.plandesk/` (project binding) — distinct from `~/.plandesk/` (server data dir). See [plandesk connect](/connecting-agents/connect/).

## Product design

Full requirements and interface specs live in the Plan Desk RFC (`plandesk-rfc/`).
