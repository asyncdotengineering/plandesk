---
title: Workspaces
description: The Org → Workspace → Project tenancy model — a workspace is a better-auth team that groups projects, members, agent keys, and client shares.
---

A **Workspace** is the middle tier of Plan Desk's tenancy model: it sits between an organization and its projects. A workspace is implemented as a native **better-auth team** (`team` / `teamMember`) — there is no parallel custom table.

```
Org        asyncdot                       better-auth organization (tenant)
 └ Workspace  Fiji TV                      better-auth TEAM (members + the agent/repo boundary)
    └ Project   OTT Mobile, QA & Bug Fixes  domain board (canvas, tasks, docs) — projects.workspace_id
```

## Why a workspace

One concept solves four real shapes at once:

- **Agent isolation.** Bind a repo to one workspace and its agent gets a key scoped to _that workspace's projects and nothing else in the org_. A stray key on a client engagement can never read your other clients' boards.
- **Multi-project folders.** A single client or product often carries several projects (one repo per service, or a portfolio of initiatives). A workspace groups them so `connect --workspace` binds the whole set at once.
- **Client engagements.** A workspace is the natural unit of a client engagement: invite the client's people into it, and (optionally) share the entire workspace with the client over the portal.
- **Member scoping.** Membership and invitations are workspace-scoped. A teammate belongs to the workspaces they need, not the whole org.

## The model

- Every project belongs to **exactly one** workspace (`projects.workspace_id`, NOT NULL).
- Each organization has a **default workspace** named **General**. Projects created without an explicit workspace land there, so nothing ever lives "outside" a workspace.
- A workspace has **members** (better-auth `teamMember`). A user can belong to multiple workspaces in the same org.
- Org roles (`owner` / `admin` / `member`) still govern who can create workspaces and invite. Custom per-workspace role ladders are future.

## Auth tiers

An agent key carries one of three scopes (see [Architecture → Auth and tenancy](/reference/architecture/#auth-and-tenancy)):

| Tier          | Metadata                   | Reach                                                  |
| ------------- | -------------------------- | ------------------------------------------------------ |
| **Owner**     | `{ orgId, kind: 'owner' }` | Every workspace and project in the org                 |
| **Workspace** | `{ orgId, teamId }`        | All projects in one workspace, nothing else in the org |
| **Project**   | `{ orgId, projectId }`     | That one project                                       |

The owner key (from `plandesk login`) mints workspace- and project-scoped keys. Agents never receive the owner key.

## Scoping guarantee

A workspace-scoped key can reach **only its workspace's projects**. A request for a project outside the scoped workspace returns the **same `404` as a non-existent project** — there is no existence leak, no distinguishable "forbidden vs. missing." Owner keys skip the guard.

This is enforced in the service layer (`assertProjectInWorkspace`), extending the existing `projectId → 404` project guard. It applies to every read path: REST, MCP, and the client portal.

## How things relate

| Entity       | Lives under   | Notes                                                               |
| ------------ | ------------- | ------------------------------------------------------------------- |
| Organization | (root tenant) | better-auth `organization`; billing/identity boundary               |
| Workspace    | Organization  | better-auth `team`; the agent/repo boundary                         |
| Project      | Workspace     | `projects.workspace_id`; one workspace each                         |
| Member       | Workspace     | better-auth `teamMember`; a user may join many workspaces in an org |
| Invitation   | Workspace     | invite email + role to a workspace; accepting joins the team        |
| Client share | Workspace     | share an entire workspace → portal shows all its projects           |
| Agent key    | Workspace/org | workspace- or project-scoped; owner keys span the org               |

## CLI

| Command                                                            | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `plandesk workspace create <name> [--to <org>]`                    | Create a workspace in an org (local by default; `--to` hosted)   |
| `plandesk workspace list [--to <org>]`                             | List workspaces in an org                                        |
| `plandesk connect [--workspace <name>] [--to <org>]`               | Bind a repo to a workspace; mint a workspace-scoped key (hosted) |
| `plandesk go-online [--to <org>] [--all \| --workspace <name>...]` | Push local workspaces + projects up to a hosted org              |
| `plandesk legacy-upgrade [--into-workspace <name>]`                | Import an old board into a workspace                             |

See [CLI reference](/reference/cli/) for flags. Connecting a repo to a workspace writes a `plandesk-connect-v2` config — see [plandesk connect](/connecting-agents/connect/).

## Dashboard

The web UI is workspace-aware: a nav switcher (Org ▸ Workspace ▸ Projects, backed by better-auth's active team) filters the projects home to the active workspace. From there you can:

- create / rename / delete workspaces,
- move a project between workspaces,
- manage workspace members (add / remove / list),
- invite a person to a workspace (link-only, owner/admin-gated), and
- share a whole workspace with a client over the portal.

For the collaboration model — invitations, client shares, submissions — see [Collaboration & sharing](/reference/collaboration/).
