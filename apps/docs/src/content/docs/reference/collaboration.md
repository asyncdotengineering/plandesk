---
title: Collaboration & sync (architecture)
description: How Plan Desk shares a project with external clients and teams — a local-first core plus a hosted, edge-deployable sync tier.
---

:::note[Shipped in 0.4.0 — single-tenant]
Client collaboration ships in `@plandesk/*` **0.4.0** (Phases 1–5: portal, join, intake, pull→triage, live status-back, plus `plandesk deploy` / `share create`). This page explains the architecture; the design lives in [`rfcs/client-collaboration-sync/`](https://github.com/asyncdotengineering/plandesk/tree/main/rfcs/client-collaboration-sync). A deployment is **single-tenant** today — multi-tenancy (org isolation, Phase 6) is the remaining gated phase.
:::

Plan Desk stays local-first while letting you share a project — read-only and live — with an external client or another team, and take their issues back into your plan. It does this with **two cleanly separated planes**.

## Two planes

**1. Local-first core — the source of truth.** Plan Desk runs on your machine (`plandesk serve`, a SQLite workspace, the canvas/board/docs UI, your agent over MCP). All authoring and agent execution happen here, offline-capable. Sharing changes nothing about it.

**2. Hosted sync tier — a rendezvous, not a source of truth.** A small Hono server (`@plandesk/sync-server`) that holds only what's shared: participant identities/sessions, a moderated submission inbox, and an activity log. The client view itself is **not** stored — it is computed live from the hosted project on read, so there is no snapshot to drift. It runs **anywhere** — your laptop, a Node box, or **Cloudflare Workers + D1** at the edge (see [Portable store](#portable-store)).

```
   LOCAL (source of truth, offline-capable)            HOSTED sync tier (rendezvous; NOT source of truth)
 ┌────────────────────────────────────────┐  push   ┌──────────────────────────────────────────────┐
 │ plandesk serve + SQLite workspace       │ ──────▶ │ @plandesk/sync-server (Hono)                  │
 │  services (only write path) + SSE       │         │  /api/sync/v1/*   (sync token — owner)        │
 │  ShareService → ClientView (allow-list) │  pull   │  /api/portal/v1/* (participant token — guest) │
 │  syncService: publish / push / pull /   │ ◀────── │  store: libSQL (Node) | D1 (Cloudflare edge)  │
 │    triage / sync --watch                │         │  shares · participants · submissions · log    │
 └────────────────────────────────────────┘         └──────────────────────────────────────────────┘
        ▲  MCP token (agent)                                  ▲  participant token (named guest)
   coding agent                                          the same web app, in read-only "portal" mode
```

## The flow

- **Outbound (owner → hosted).** `syncService.push` builds an **allow-list `ClientView`** for each share — only the tasks, edges, progress, and documents you've shared; internal documents, comments, agent runs, and assignees are _structurally absent_, never serialized — and PUTs it to the sync server. `plandesk sync --watch` does this debounced on every local change, so the guest sees status move in ~2s.
- **Participant (guest → hosted).** A guest opens `/p/:shareToken`, **joins with their name** (invite-scoped or public) to get a scoped session, and views the live client view (session-gated, isolated to that one share). They can file issues into a **moderated inbox**. The view polls, so status changes appear within the poll interval.
- **Inbound (hosted → owner).** `plandesk pull` brings submissions into a **local triage inbox**. Accepting one creates a **real task through the normal write path** — so it appears on your canvas/board and your agent can `get_next_task` it — and the status is acked back so the guest sees `accepted`.
- **Agent-operable.** The whole loop is available over MCP — `sync_pull`, `list_submissions`, `triage_submission` — so an agent can pull a client's bug, triage it, scaffold it, and work it.

## Security by construction

The two load-bearing invariants are enforced by the _shape of the system_, not by careful filtering:

- **Allow-list egress.** The only bytes that leave your machine are the projected `ClientView`. Internal entities are never written into a projection — so even a breach of the hosted server or its database exposes only what was already shared with that client.
- **Proposals, never writes.** A participant can only append a `pending` submission. They cannot create, edit, or delete a task, edge, document, or status. Real work is created solely by the owner's (or agent's) `accept` on the local source of truth.

Supporting these: three capability-token types — agent↔local (MCP), local↔hosted (sync), guest↔share (participant) — each hashed at rest, scoped, expiring, and revocable; session-gated views that reject a session presented for a different share; and invite-email scoping.

## Portable store

The sync server is **async over a portable SQLite type**, with adapters chosen at deploy time — the same approach PayloadCMS uses for its SQLite/Postgres adapters:

- **libSQL** for local development, the test suite, and Node/Docker self-hosting.
- **Cloudflare D1** for an edge Workers deployment (`wrangler deploy` with a D1 binding + `nodejs_compat`).

The handler and query code are identical across both; only the client factory differs. This keeps the hosted tier honest about Plan Desk's local-first, self-hostable ethos — you can run it on your own box, or push it to the edge.

## What's not here yet

- **Multi-tenancy** — today a deployment is single-tenant (one team / one self-hosted instance). Org isolation with fail-closed tenant scoping and intra-org project ACLs is the gated final phase.

See [The Skill](/connecting-agents/skill/) for how an agent already drives the planning loop, and the [REST + MCP API](/reference/api/) for the current 46 tools.

## Agent share links (a lighter-weight sibling)

`create_share_link` mints the same kind of `shares` row as `share create` above, but scoped by policy to a **single task or document** instead of a curated allow-list, and it adds one more surface: `GET /api/v1/share/:token.md` renders that resource as agent-ready Markdown (linked documents inlined, an instruction to fetch every embedded image, relative URLs absolutized). It defaults to a 24h TTL (`never` disables expiry).

This is not the client-collaboration portal — no participant joins, no submissions, no live status-back. It exists for one thing: handing a delegated worker or sub-agent full context via a URL (`Context: <markdown_url>` in a brief) without granting it MCP access to the whole project. See [REST + MCP API → Share links](/reference/api/#share-links).
