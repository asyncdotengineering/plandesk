---
title: Collaboration & sharing (architecture)
description: How Plan Desk shares a project with external clients — one hosted server, guest sessions, and a moderated submission inbox.
---

:::note[Single server]
As of BA6, collaboration runs on **one server** (`@plandesk/api` / `plandesk serve`). There is no separate `@plandesk/sync-server` deployable. Guest join, portal view, and moderated submissions all live on the same API that holds your projects.
:::

Plan Desk stays local-first while letting you share a project — read-only and live — with an external client or another team, and take their issues back into your plan.

## One plane for hosted collaboration

**Local-first core** remains the default for day-to-day authoring: `plandesk serve`, a SQLite workspace, the canvas/board/docs UI, your agent over MCP.

**Hosted (or self-hosted) API** is the same binary when you promote a project or run a shared instance. It owns:

- Projects and the live **client view** (computed per request from the hosted project — no snapshot to drift)
- **Share tokens** and **guest sessions** (named join, invite allow-list when `mode=invite`)
- The **moderated submission inbox** (`share_submissions`) and owner triage

```
   LOCAL (optional offline workspace)              HOSTED / SELF-HOSTED (plandesk-api)
 ┌────────────────────────────────────┐  promote  ┌──────────────────────────────────────────┐
 │ plandesk serve + SQLite             │ ──────▶  │ @plandesk/api (Hono)                       │
 │  services + MCP                     │          │  /api/v1/share/*   (meta, join, view,     │
 │  ShareService → ClientView          │          │                   submissions)            │
 │  triage inbox (local or same DB)    │          │  guest sessions · share_submissions       │
 └────────────────────────────────────┘          └──────────────────────────────────────────┘
        ▲  MCP token (agent)                                ▲  guest session (named participant)
   coding agent                                        portal SPA at /p/:shareToken
```

## The flow

- **Outbound (owner).** Promote the project to a hosted org (`plandesk push --to <org-id>` when using a remote API). Create a share: `plandesk share create --audience "Acme" --public --allow-submit`.
- **Participant (guest).** Opens `/p/:shareToken`, **joins with a name** (invite-scoped or public) to get a guest session, views the live client view (session-gated), and can file issues into the **moderated inbox** when `submit` is allowed.
- **Inbound (owner).** Submissions land as `pending` rows on the same server. List them (`GET /api/v1/projects/:id/submissions` or MCP `list_submissions`) and **accept** (creates a real task in `scope`) or **reject**. Guests only ever append pending submissions — never write tasks.
- **Agent-operable.** MCP tools `list_submissions` and `triage_submission` cover the owner inbox.

## Workspace-level collaboration

Plan Desk's tenancy is **Org → Workspace → Project**, and the collaboration primitives are **workspace-scoped** (see [Workspaces](/reference/workspaces/)). The same guest-session + `ClientView` machinery widens from a single project to a whole workspace.

**Invitations.** You invite a person (or a client) to a **workspace** with a role (`owner` / `admin` / `member`); accepting joins the *team* behind that workspace, not just the org. Invitations are link-only — there is no mailer; the inviter gets a `claimUrl` to deliver by hand — and owner/admin-gated (a non-owner/admin cannot create one; better-auth additionally blocks inviting an owner as a non-owner). Session-only: a token or loopback caller cannot drive the invite path.

**Client sharing.** Share an entire workspace with a client and their portal shows **every project in that workspace** (read-only, submit-if-allowed). The same projection rules apply — internal entities are never serialized into the portal; a client only ever reads the workspace's projects and appends pending submissions.

**Dashboard.** The web UI is workspace-aware: a nav **workspace switcher** (Org ▸ Workspace ▸ Projects, backed by `setActiveTeam`) filters the projects home, plus workspace CRUD, **move-project-between-workspaces**, **member management** (add / remove / list), invite-to-workspace, and share-workspace-with-client.

The CLI `share create` command (below) remains **per-project**. Workspace invites and workspace shares are created from the dashboard.

## Security by construction

- **Allow-list egress.** The client view is a projected allow-list. Internal entities are not serialized into the portal.
- **Proposals, never writes.** A participant can only create a `pending` submission. Real work is created solely by owner/agent accept.
- **Guest session gate.** Portal view and submissions require a guest session minted by join for that share token (not org auth, not loopback fallback).
- **Tenant isolation.** A workspace-scoped agent key, member, or workspace client share reaches only its own workspace's projects; any project outside the scoped workspace returns the same `404` as a missing one (no existence leak). Cross-workspace and cross-org requests are indistinguishable from missing ones. See [Architecture → Agent key scopes](/reference/architecture/#agent-key-scopes).

## Agent share links (a lighter-weight sibling)

`create_share_link` mints a `shares` row scoped to a **single task or document**, served as `GET /api/v1/share/:token.md`. No participant join, no submissions — context handoff for a delegated worker. See [REST + MCP API → Share links](/reference/api/#share-links).
