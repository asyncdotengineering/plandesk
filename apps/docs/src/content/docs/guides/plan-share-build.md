---
title: Plan → share → build with your team
description: Share a planned project with a client or teammate over a read-only live portal, take their issues into your plan, and build — without giving up local-first authoring.
---

You've planned a project (if not, start with [Plan & execute a project](/guides/plan-and-execute/)). Now you want a client or another team to **watch it live and file issues** — without handing them your repo, your internal docs, or edit access. That's the collaboration tier: a hosted **rendezvous** server holds only a curated projection you push; your plan stays local and authoritative.

The loop: **share a read-only live view → they file issues into a moderated inbox → you pull, triage into real tasks, and build → status flows back to them live.**

We'll use one running example: you're sharing **"Add rate limiting to our public API"** with a client, **Acme Corp**.

## 1. Stand up a sync server — let your agent do it

The hosted tier runs anywhere — your own Cloudflare account, a Node box, or Docker. The fastest path hands the whole deploy to your coding agent:

```bash
plandesk deploy                      # list available guides
plandesk deploy cloudflare | claude  # agent runs the guide end-to-end
```

`plandesk deploy` prints the deploy guide to stdout; piping it to Claude Code (or `| codex`, `| cursor-agent`) lets the agent stand up the sync server on Cloudflare Workers + D1, deploy the portal to Pages, **publish your project**, and hand you back a share link — following a hosted, grounded runbook, writing nothing secret into your repo. See [Collaboration & sync](/reference/collaboration/) for the architecture.

Prefer to do it yourself? The same guide is human-readable — run `plandesk deploy cloudflare` and follow it, or self-host the [`@plandesk/sync-server`](/reference/collaboration/#portable-store) package on any Node host.

Once a server exists, register your project against it (this writes the sync config and a git-ignored sync token — never committed):

```bash
plandesk publish --remote https://<your-sync-server>
```

## 2. Create a share for an audience

A **share** is one named audience with its own participant token. Mint one:

```bash
plandesk share create --audience "Acme Corp" --public --allow-submit
```

It prints a `plandesk_share_…` token **once** (only its hash is stored) and the link template. The shareable link is `<your-portal-url>/p/<token>`. Flags:

- `--public` — anyone with the link joins by name (Zoom-style). Omit it and use `--invite a@b.com,c@d.com` for an invite-only audience.
- `--allow-submit` — let this audience file issues. Omit for view-only.
- `--expires 30d` — time-box the link (`h`/`d`/`w`).

Then push the curated projection and keep it live:

```bash
plandesk push                 # upload the allow-list ClientView once
plandesk sync --watch         # …or stream every local change to the portal (~2s)
```

## 3. What your team sees

Send Acme the link. They open `<portal>/p/<token>`, **enter their name**, and get a scoped, read-only view of exactly what you shared:

- the **board** and **flow canvas** — tasks, statuses, dependency edges, shared docs;
- **nothing internal** — agent runs, internal documents, comments, and assignees are _structurally absent_ from the projection, never just hidden;
- **no edit handles** — they can't move a card, edit a task, or change status.

With `--allow-submit`, they get an **Add issue** affordance that files into a moderated inbox. They can watch their submissions, but they never touch your source of truth.

## 4. Pull their issues → triage → build

Submissions land on the hosted inbox. Bring them into a local triage inbox:

```bash
plandesk pull
```

Now triage from Claude Code over MCP — accepting a submission creates a **real task through the normal write path**, so your agent can pick it up:

> Use Plan Desk MCP. Call `list_submissions` for this project. For each that's a real bug, `triage_submission` to accept it — that creates a task on the plan. Then run the build loop: `get_next_task`, read the spec, make the change, run tests, `update_task` to `done`.

Accepting acks the status back to Acme, so their submission shows **accepted**. As your agent builds and flips tasks to `done`, `sync --watch` pushes each change — Acme watches **in-progress → done** on their board with no refresh. The issue they filed becomes a task you shipped, and they saw the whole thing.

## Security by construction

Two invariants are enforced by the _shape_ of the system, not careful filtering:

- **Allow-list egress** — the only bytes that leave your machine are the projected `ClientView`. A breach of the hosted server exposes only what you already shared.
- **Proposals, never writes** — a participant can only append a `pending` submission. Real work is created solely by your (or your agent's) `accept` on the local source of truth.

A deployment is **single-tenant** today (one team / one self-hosted instance); org isolation is the gated next phase.

## Recap

| Step   | You                                              | Your team                          |
| ------ | ------------------------------------------------ | ---------------------------------- |
| Deploy | `plandesk deploy cloudflare \| claude`           | —                                  |
| Share  | `plandesk share create --audience …`             | open the link, join by name        |
| Live   | `plandesk sync --watch`                          | watch status move, no refresh      |
| Intake | `plandesk pull`                                  | file issues into a moderated inbox |
| Build  | `list_submissions` → `triage_submission` → build | see their issue go to `done`       |

## Next steps

- [Collaboration & sync](/reference/collaboration/) — the architecture and security model
- [From idea to development with Claude Code](/guides/idea-to-development/) — the solo build loop
- [CLI Reference](/reference/cli/) — every collaboration command and flag
