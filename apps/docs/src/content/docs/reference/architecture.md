---
title: Architecture
description: Monorepo layout, service-layer SSOT, auth (better-auth), and real-time updates via polling.
---

## Monorepo layout

```
apps/plandesk-web/          React SPA (canvas, docs, board, settings)
apps/docs/                  Astro Starlight documentation site
packages/plandesk-api/      Hono REST
packages/plandesk-db/       SQLite schema + Drizzle migrations
packages/plandesk-mcp/      MCP server (Streamable HTTP, 45 tools)
packages/plandesk-cli/      plandesk binary (init, serve, connect, …)
packages/plandesk-mcp-client/  Factory Desk / programmatic MCP consumer
```

## Published npm packages

Core packages ship under the `@plandesk/*` scope on npm (currently `1.0.0`, published under the `latest` npm tag):

| Package                | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `@plandesk/cli`        | `plandesk` binary; bundles the web UI for `serve` |
| `@plandesk/api`        | Hono REST server                                  |
| `@plandesk/db`         | SQLite schema + migrations                        |
| `@plandesk/mcp`        | MCP server (45 tools)                             |
| `@plandesk/mcp-client` | Programmatic MCP consumer                         |

Install with `npm i -g @plandesk/cli` to run Plan Desk without cloning the repo.

## Service-layer single source of truth

Task status, canvas node positions, and document content all flow through the API/DB layer. The board view and canvas read the same task rows — there is no separate board state.

MCP writes go through the same service layer as REST; the web UI picks them up on its next poll (~2.5 s).

## Auth and tenancy

**Local is the default.** On loopback, the server treats the caller as the workspace owner: offline, zero-auth, agent-runnable without an account.

**Hosted (and multi-user self-host) auth is 100% better-auth** — sessions, API keys, organization identity, membership, roles, and invitations. There is no parallel hand-rolled auth stack.

| Actor | How they authenticate |
| ----- | --------------------- |
| **Human (web)** | GitHub social sign-in → better-auth **session** (cookie). Mounted at `/api/auth/*`. |
| **Human (CLI)** | Dashboard **Generate CLI token** (org-wide better-auth API key) → paste via `plandesk login` into `~/.plandesk/config.json`. |
| **Agent** | Never logs in. After a human has logged in, `plandesk connect --to <org>` mints a **project-scoped agent key** into `.plandesk/token` (gitignored). MCP reads that file (or `PLANDESK_MCP_TOKEN`). |

**Organizations and workspaces.** The tenancy model is **Org → Workspace → Project**. better-auth’s `organization` / `member` tables are the single source of truth for orgs and membership, and a **workspace** is a native better-auth **team** (`team` / `teamMember`) — there is no parallel custom table. Every project belongs to exactly one workspace (`projects.workspace_id`); each org gets a default **General** workspace so no project ever sits outside one. Roles are **permission sets** (`owner` / `admin` / `member` via better-auth access-control), not a rank ladder. Domain rows carry an `org_id` scoping column; cross-org access returns 404. A user can belong to more than one organization; the dashboard's account menu has an **org switcher** backed by better-auth's active-organization, and a **workspace switcher** (Org ▸ Workspace ▸ Projects) backed by its active team — so accepting an invitation to a second org or joining a second workspace is just a switch, not a separate account. See [Workspaces](/reference/workspaces/).

**Agent key scopes.** A scoped agent key is one of three tiers:

| Tier          | Reach                                                         |
| ------------- | ------------------------------------------------------------- |
| **Owner**     | Every workspace and project in the org                        |
| **Workspace** | All projects in one workspace (`{ orgId, teamId }`)           |
| **Project**   | That one project (`{ orgId, projectId }`)                     |

A workspace-scoped key can read only its workspace’s projects; a project outside the scoped workspace returns the **same 404 as a missing project** (no existence leak), enforced in the service layer by `assertProjectInWorkspace`. Owner keys skip the guard. Cross-workspace and cross-org requests are indistinguishable from missing ones.

**Upgrade note.** Pre–better-auth installs used a separate token table, a GitHub device-code CLI login, hand-rolled browser sessions, and a parallel org-membership schema. Those paths are deleted — not dual-stacked. Operators on 0.20.x or earlier must **re-initialize the database** (fresh migration baseline; no in-place migration) and regenerate CLI tokens from the dashboard. Full migration path — including `plandesk legacy-upgrade` to lift an old board's planning data into the new global one: [Upgrading → The 0.20.x → better-auth upgrade](/reference/upgrading/#the-020x--better-auth-upgrade-breaking). Concrete breaking-change list: [CHANGELOG 1.0.0-beta.1 → Breaking](https://github.com/asyncdotengineering/plandesk/blob/main/CHANGELOG.md).

## Real-time updates

The web UI stays in sync by **polling**: TanStack Query re-fetches task, canvas, and agent-run data on a short interval (~2.5 s — see `LIVE_QUERY_POLL_MS` in `apps/plandesk-web/src/lib/events.ts`) plus on window focus. An earlier Server-Sent Events stream at `/api/v1/events` was removed in favor of polling — a stateless Cloudflare Worker can't fan a change out to other connected clients. Because every mutation (REST or MCP) lands in the same store, the next poll reflects it regardless of who wrote it.

## Data model

SQLite workspace at `~/.plandesk/workspace.db` by default (one global board per machine). An existing repo-local `.plandesk/workspace.db` (from `plandesk init --local-db`) is preferred when present; otherwise commands fall through to the global board:

- `projects` — project metadata (`org_id` scopes hosted rows; `workspace_id` scopes to one workspace)
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

better-auth owns its own tables (user, session, account, organization, member, **team**, **teamMember**, invitation, apikey, …), created by its runtime migrator alongside the Drizzle domain schema — not listed as domain entities above. `team` / `teamMember` back workspaces.

## Frontend

- **Stack:** React 19, Vite, TanStack Router, TanStack Query, `@xyflow/react` (canvas), TipTap (docs)
- **Routes:** `/`, `/projects/:id/{overview,flow,board,goals,inbox}`, `/projects/:id/documents(/:docId)`, `/projects/:id/notes(/:noteId)`, `/settings/{mcp,members}`, `/invite/:invitationId`, `/p/:shareToken` (client portal)
- Served as static SPA assets by the API server in production

## Repo binding

`plandesk connect` writes `<repo>/.plandesk/` (config, skill, token) — a binding, not the board. The board lives on the machine-global `~/.plandesk` by default; `plandesk init --local-db` is the opt-in for a repo-local workspace. `connect --project` binds to one project; `connect --workspace` binds to a whole workspace and writes a `plandesk-connect-v2` config. See [plandesk connect](/connecting-agents/connect/).

## Product design

Full requirements and interface specs live in the Plan Desk RFC (`plandesk-rfc/`).
