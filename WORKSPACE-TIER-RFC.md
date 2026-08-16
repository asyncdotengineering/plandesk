# RFC: Workspace tier — full better-auth-teams-native (org → workspace → project)

Status: **Design for review → pi-kimi implementation** · Target: **1.0.0 GA (blocks on this)** · Scope: **everything in v1**

## 1. Summary

Introduce **Workspace** between Org and Project, implemented as a **better-auth team** (fully native — no parallel entity). An org has many workspaces (teams); a workspace has many projects and members. A repo/folder binds to **one workspace**; its agent gets a **workspace-scoped token** (all projects in that workspace, nothing else in the org). **Invitations and client sharing move to the workspace level.**

```
Org        asyncdot                       better-auth organization (tenant, billing)
 └ Workspace  Fiji TV                      better-auth TEAM (members + the agent/repo boundary)   ← NEW
    └ Project   OTT Mobile, QA & Bug Fixes  domain board (canvas, tasks, docs) — projects.workspace_id
```

Solves, in one concept: **agent isolation**, **multi-project folders** (fiji=2, plandesk=5), **workspace membership**, an **active-workspace switcher**, **workspace-scoped invites**, and **workspace client sharing**.

## 2. Decisions (locked)

- **Workspace = better-auth team.** Go full native: enable `teams`, use `team` + `teamMember` + `setActiveTeam` + team invitations. No custom `workspaces` table.
- **Naming:** entity = **Workspace** (product name for a better-auth team, as "org" is our name for `organization`). Local board file **`workspace.db` → `plandesk.db`** (global `~/.plandesk/plandesk.db`); per-repo DBs deleted on migration.
- **Everything in v1:** membership, active-workspace switcher, workspace-scoped agent keys, **workspace-level invitations**, **workspace-level client sharing**. Only _billing_ stays out (no billing foundation exists).
- **Invites are workspace-scoped** — you invite a person (or client) to a **workspace**, with a role; the org-level invite flow we shipped (beta.4/5) is refactored onto teams/workspaces.
- A project belongs to **exactly one** workspace. Each org has a **default workspace** ("General").
- **GA (1.0.0) ships with this** + the port default → **7526**.

## 3. Data model

- **Enable better-auth teams:** `organization({ ac, roles, teams: { enabled: true } })`. This adds better-auth's `team` (id, name, organizationId, …) and `teamMember` (teamId, userId) tables via its migrator.
- **`projects.workspace_id`** (text NOT NULL) → references the team id. Every project belongs to one workspace.
- Default team/workspace per org ("General", slug `default`); projects created without a workspace land there.
- Domain reads gain a workspace filter when the auth context is workspace-scoped; existing `org_id` scoping stays.

## 4. Auth & scoping (native teams)

- **Agent key metadata gains a workspace tier** (`agent-keys.ts`): `owner {orgId,kind:'owner'}` (all workspaces) · **workspace `{orgId, teamId}`** (all projects in the team) · `project {orgId, projectId}` (one). `AuthContext` apikey kind gains `workspaceId?`.
- **Enforcement** (`services/scope.ts`): extend the existing `ctx.projectId → 404` guard with `assertProjectInWorkspace(db, projectId, workspaceId)` — a project not in the scoped workspace returns the same 404 (no existence leak). Owner keys skip it.
- **Active workspace:** wire better-auth `setActiveTeam` / active-team into the session so the resolved context carries the active workspace (mirrors the active-org self-heal we already have).
- Loopback stays zero-auth owner **only when no token is presented** (Bearer resolves first, already true `auth.ts:391`). Local `connect --workspace` mints a workspace-scoped key against local better-auth.

## 5. Membership & invitations (workspace-scoped)

- **Membership** via better-auth `addTeamMember` / `removeTeamMember` / `listTeamMembers`. A user can belong to multiple workspaces in an org.
- **Invitations move to the workspace level** — refactor the current org invite (`POST /orgs/:id/invitations`, the `/invite/:id` claim page) into **workspace invitations** (invite email + role **to a workspace**; claim → join the _team_, not just the org). Keep the link-only, owner/admin-gated model; better-auth invitations carry the team.
- Org roles (owner/admin/member) still govern who can invite/manage; **custom per-workspace role ladders stay future** (v1 uses org roles + team membership).

## 6. Client sharing (workspace-level) — IN v1

- Extend the portal/share model from single-resource to a **workspace**: share an entire engagement with a client → the client's portal shows **all projects in that workspace** (read-only, submit-if-allowed).
- Reuse the existing guest-session + `ClientView` machinery, widened from one project to a workspace's project set. New: a workspace share token + a workspace projection.

## 7. CLI

- `plandesk workspace create <name> [--org <org>]` / `plandesk workspace list`.
- `plandesk connect --workspace <slug|name> [--to <org>] [--repo <dir>]` — binds the repo to a workspace, mints a **workspace-scoped** token → `.plandesk/token`. Config → `plandesk-connect-v2`: `{ serverUrl, orgId, workspaceId, workspaceName, projectIds:[…] }` (short grace-read of v1 configs).
- `plandesk legacy-upgrade [--from <db>] [--into-workspace <name>]` — imports an old board's projects into a workspace (creates it; **defaults the name to the folder name**).

## 8. MCP

- `.plandesk/config.json` identifies the bound workspace; `list_projects` returns **only** that workspace's projects (token-enforced); the agent resolves a project within the workspace. Cross-workspace project id → 404.
- Update `.plandesk/skill.md`: "resolve the project within the bound workspace."

## 9. Web

- **Workspace switcher** in the nav: Org ▸ Workspace ▸ Projects (backed by `setActiveTeam`). Projects home filtered to the active workspace.
- Workspace **CRUD**, **move project between workspaces**, **member management** (add/remove/list — the deferred membership, now in v1), **invite to workspace**, **share workspace with a client**.

## 10. Migration

- **Schema:** enable teams (team/teamMember tables); add `projects.workspace_id`; backfill — one "General" team per distinct `org_id`, every existing project → it. Idempotent.
- **Machine (14 folders), one pass onto the final shape:** ship 1.0.0 → install `@latest` → archive `~/.plandesk/workspace.db`, fresh `~/.plandesk/plandesk.db` (port 7526) → per folder: `legacy-upgrade --into-workspace "<Client>"` (fiji's 2 / plandesk's 5 land together) → `connect --workspace "<Client>"` → `doctor`. Edge cases: `sliit-chatbot` (empty local db), `kuralle-platform` (no local db), `minimal-draft-suite` (1 project).

## 11. Scope

**v1 (all of it):** teams enabled; `projects.workspace_id`; workspace-scoped keys + enforcement; active-workspace; membership; **workspace invitations**; **workspace client sharing**; CLI (`workspace`, `connect --workspace`, `legacy-upgrade --into-workspace`); MCP scoping + skill; web switcher + CRUD + move + members + invite + share; schema backfill; local db → `plandesk.db`; port 7526; docs; tests.
**Future:** custom per-workspace role ladders; billing per workspace; in-app notifications (see the board task) + audit-logs (both natural follow-ons that should stay compatible with this).

## 12. Risk & test bar

- **Early adopter of better-auth teams** (thin public usage — see gh research). Lean on better-auth's own docs/tests; validate the team APIs behave as expected with our own tests. Pin better-auth.
- **Scoping bugs = cross-client data leaks, not cosmetic.** The test plan is non-negotiable:
  - workspace-scoped key reads its workspace's projects; **any project outside → 404**; owner sees all; project-scoped key still narrow.
  - membership add/remove; a member can't reach a workspace they're not in.
  - workspace invitation → claim → team membership; non-owner/admin can't invite.
  - workspace share → client portal sees exactly that workspace's projects; nothing else.
  - migration builds teams + `workspace_id`, backfills a default team, idempotent; `legacy-upgrade --into-workspace` lands a 2-project board in one workspace.
  - MCP `list_projects` returns only the bound workspace's projects.
- **Manager reviews the diff hard** (esp. `scope.ts`, agent-keys, the invite/share refactor). Deliver in phases (foundation → scoping → CLI/MCP → web → invites/sharing → migration → GA), each verified before the next.
