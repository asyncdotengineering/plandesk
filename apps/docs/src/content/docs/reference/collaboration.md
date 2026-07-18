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

## Security by construction

- **Allow-list egress.** The client view is a projected allow-list. Internal entities are not serialized into the portal.
- **Proposals, never writes.** A participant can only create a `pending` submission. Real work is created solely by owner/agent accept.
- **Guest session gate.** Portal view and submissions require a guest session minted by join for that share token (not org auth, not loopback fallback).

## Agent share links (a lighter-weight sibling)

`create_share_link` mints a `shares` row scoped to a **single task or document**, served as `GET /api/v1/share/:token.md`. No participant join, no submissions — context handoff for a delegated worker. See [REST + MCP API → Share links](/reference/api/#share-links).
