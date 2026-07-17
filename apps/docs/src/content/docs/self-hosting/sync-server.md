---
title: Hosted collaboration (single server)
description: Share a project with clients using the same Plan Desk API you self-host — no separate sync-server package.
---

:::caution[Package removed]
`@plandesk/sync-server` is **removed**. Guest portal, join, and moderated submissions run on **`@plandesk/api`** (the same process as `plandesk serve` / your self-hosted API). Deploy one server, not two.
:::

## What you deploy

One Plan Desk API process with a database:

- Local: `plandesk serve` (auto-migrates SQLite)
- Self-host: Docker / your host with `PLANDESK_DB_URL` — see [Docker](./docker/) and [topologies](./topologies/)

The portal SPA is the same web app in guest mode at `/p/:shareToken`. It talks only to this API (`/api/v1/share/...`). There is no `VITE_SYNC_URL` and no second portal backend.

## Configure authentication

Auth is **better-auth** (sessions + API keys + organization membership). Self-hosting does not require a GitHub app.

- **Without GitHub:** the dashboard offers token entry; operators sign in with a CLI owner key. CLI: human pastes a dashboard-minted owner key via `plandesk login --server <url>`, then `plandesk connect --to <org>` mints a project-scoped agent key.
- **With GitHub:** web users sign in with GitHub social (better-auth session). CLI auth remains **paste-a-token only** (no browser device-code login). Generate a CLI token in the dashboard while signed in, then `plandesk login`.

Local loopback remains zero-auth (owner). See [CLI Reference — Hosted login](/reference/cli/#hosted-login-and-connect-two-actor) and [Server configuration](./server-config/).

## Promote and share

```bash
plandesk login --server https://your-host.example   # paste owner key from dashboard
plandesk push --to <org-id>
plandesk share create --audience "Acme" --public --allow-submit
```

Participants open the share link, join with a name, and submit issues through the portal. Those submissions appear in the owner's triage inbox on the **same** server (list + accept/reject). No separate pull hop is required when owner and portal share the API database.

Keep tokens and database credentials in the runtime environment or git-ignored local files. Do not commit them.

## See also

- [Collaboration architecture](/reference/collaboration/)
- [Troubleshooting](/reference/troubleshooting/)
