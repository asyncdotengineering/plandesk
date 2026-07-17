---
title: Architecture
description: Monorepo layout, service-layer SSOT, auth (better-auth), and real-time SSE.
---

## Monorepo layout

```
apps/plandesk-web/          React SPA (canvas, docs, board, settings)
apps/docs/                  Astro Starlight documentation site
packages/plandesk-api/      Hono REST + SSE
packages/plandesk-db/       SQLite schema + Drizzle migrations
packages/plandesk-mcp/      MCP server (Streamable HTTP, 46 tools)
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
| `@plandesk/mcp`        | MCP server (46 tools)                             |
| `@plandesk/mcp-client` | Programmatic MCP consumer                         |

Install with `npm i -g @plandesk/cli` to run Plan Desk without cloning the repo.

## Service-layer single source of truth

Task status, canvas node positions, and document content all flow through the API/DB layer. The board view and canvas read the same task rows — there is no separate board state.

MCP writes go through the same service layer as REST and broadcast SSE events within 500 ms.

## Auth and tenancy

**Local is the default.** On loopback, the server treats the caller as the workspace owner: offline, zero-auth, agent-runnable without an account.

**Hosted (and multi-user self-host) auth is 100% better-auth** — sessions, API keys, organization identity, membership, roles, and invitations. There is no parallel hand-rolled auth stack.

| Actor | How they authenticate |
| ----- | --------------------- |
| **Human (web)** | GitHub social sign-in → better-auth **session** (cookie). Mounted at `/api/auth/*`. |
| **Human (CLI)** | Dashboard **Generate CLI token** (org-wide better-auth API key) → paste via `plandesk login` into `~/.plandesk/config.json`. |
| **Agent** | Never logs in. After a human has logged in, `plandesk connect --to <org>` mints a **project-scoped agent key** into `.plandesk/token` (gitignored). MCP reads that file (or `PLANDESK_MCP_TOKEN`). |

**Organizations.** better-auth’s `organization` / `member` tables are the single source of truth for orgs and membership. Roles are **permission sets** (`owner` / `admin` / `member` via better-auth access-control), not a rank ladder. Domain rows carry an `org_id` scoping column; cross-org access returns 404.

**Upgrade note.** Pre–better-auth installs used a separate token table, a GitHub device-code CLI login, hand-rolled browser sessions, and a parallel org-membership schema. Those paths are deleted — not dual-stacked. Operators upgrading must **re-initialize the database** (fresh migration baseline; no in-place migration) and regenerate CLI tokens from the dashboard. Concrete list and operator steps: [CHANGELOG Unreleased → Breaking](https://github.com/asyncdotengineering/plandesk/blob/main/CHANGELOG.md).

## Real-time updates (SSE)

The UI subscribes to `GET /api/v1/events` for task, canvas, and agent-run changes. MCP tool calls that mutate state trigger the same SSE events as REST PATCH requests.

## Data model

SQLite workspace at `~/.plandesk/workspace.db` by default (one global board per machine). An existing repo-local `.plandesk/workspace.db` (from `plandesk init --local-db`) is preferred when present; otherwise commands fall through to the global board:

- `projects` — project metadata (`org_id` scopes hosted rows)
- `goals` — goal-altitude nodes (`objective`, `verification_surface`, contract fields, `status`, `last_verification`)
- `tasks` — canvas nodes + board status (`scope` | `todo` | `in_progress` | `done` | `backlog`); every task has a required `goal_id`
- `edges` — labeled directed dependencies between tasks
- `documents` — markdown bodies with optional `linked_task_id`
- `notes` — free-form project working notes
- `artifacts` — stored agent deliverables (`title`, `kind`: `markdown` | `html`, `content`)
- `files` — content-addressed uploaded bytes (BLOB by default, pluggable `StorageAdapter`)
- `comments` — polymorphic comments keyed by `target_type` (`document` | `task` | `note` | `submission` | `artifact`) + `target_id`
- `shares` — audience or single-resource share links (token hashed at rest)
- `agent_runs` / `agent_run_events` — external agent session tracking

better-auth owns its own tables (user, session, account, organization, member, invitation, apikey, …), created by its runtime migrator alongside the Drizzle domain schema — not listed as domain entities above.

## Frontend

- **Stack:** React 19, Vite, TanStack Router, TanStack Query, `@xyflow/react` (canvas), TipTap (docs)
- **Routes:** `/`, `/projects/:id/overview`, `/projects/:id/flow`, `/projects/:id/board`, `/projects/:id/documents/:docId`, `/settings/mcp`
- Served as static SPA assets by the API server in production

## Repo binding

`plandesk connect` writes `<repo>/.plandesk/` (config, skill, token) — a binding, not the board. The board lives on the machine-global `~/.plandesk` by default; `plandesk init --local-db` is the opt-in for a repo-local workspace. See [plandesk connect](/connecting-agents/connect/).

## Product design

Full requirements and interface specs live in the Plan Desk RFC (`plandesk-rfc/`).
