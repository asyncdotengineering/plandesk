# Plan Desk

**Local-first, self-hostable planning workspace** — canvas + docs-on-nodes + tasks + board + MCP for product teams and agent workflows.

Plan Desk is a graph-native planning app you run on your machine: map dependencies on a flow canvas, attach specs to nodes, track status on a board, and let Claude Code or Codex read and update the plan over MCP. Data stays in a local SQLite workspace; export/import keeps projects portable.

## Set up with your coding agent

Let your agent wire Plan Desk into the current repo. From your project folder, paste into Claude Code (or Codex):

```text
Read https://plandesk.asyncdot.com/start.md then set up Plan Desk for this project.
```

It installs the CLI, starts the local server, creates or binds a project, and verifies — scoped to your folder, no secrets committed. Then a fresh session plans and builds from the live graph. Walkthrough: [From idea to development with Claude Code](https://plandesk.asyncdot.com/guides/idea-to-development/).

## Documentation

📖 **[plandesk.asyncdot.com](https://plandesk.asyncdot.com)** — hosted documentation: quickstart, Docker self-hosting, MCP/agent setup, CLI reference, API, architecture, and validation.

Built with Astro Starlight in [`apps/docs`](apps/docs/):

```bash
pnpm --filter @plandesk/docs dev      # http://localhost:4321
pnpm --filter @plandesk/docs build    # static site in apps/docs/dist/
```

## Quickstart

```bash
npm i -g @plandesk/cli
plandesk init
plandesk serve
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

**From source (contributors):**

```bash
git clone https://github.com/asyncdotengineering/plandesk
cd plandesk
pnpm install && pnpm build
export PATH="$PWD/packages/plandesk-cli/bin:$PATH"
plandesk init
plandesk serve
```

## Development

```bash
pnpm build          # compile all packages + web assets + docs
pnpm test           # unit + integration tests
pnpm lint           # ESLint + Prettier
pnpm validate       # live health + MCP smoke
pnpm metrics        # v1 performance targets
```

## Roadmap

### Shipped (`@plandesk/*` 0.4.0)

Local-first planning workspace: flow canvas with labeled dependency edges, specs on nodes, kanban board, 23 MCP tools (incl. `scaffold_project_from_plan`, `get_next_task`, document comments), lossless export/import, Docker self-hosting — plus the Client Collaboration tier below.

### Shipped in 0.4.0 — Client Collaboration

Share a project with an external client or another team and collaborate two-way, without giving up local-first authoring. Full design in [`rfcs/client-collaboration-sync/`](rfcs/client-collaboration-sync/). **Phases 1–5 ship the complete client-facing + owner + agent + live loop:**

- **Read-only portal** — a guest opens a share link and sees a curated, **allow-list** projection of the plan (graph + board + shared docs). Internal data is structurally absent, never filtered.
- **Named join + identity** — Zoom-style "enter your name" join → scoped, session-gated view; invite-scoped or public; append-only activity/audit log.
- **Moderated issue intake** — guests file bugs into a **proposal inbox** that never touches the source of truth; the owner pulls and triages.
- **Pull → triage → task** — `plandesk pull` brings submissions into a local triage inbox; **accept** creates a real task via the normal write path (so the agent can `get_next_task` it); status acks back to the guest. Driven by CLI (`publish`/`push`/`pull`/`sync --watch`/`share create`) and 5 MCP tools.
- **Live status-back** — a change on the owner's canvas propagates to the guest's portal in ~2s over SSE, no reload.
- **Agent-assisted deploy** — `plandesk deploy cloudflare | claude` hands a coding agent a hosted, grounded runbook that stands up your own sync server on Cloudflare Workers + D1 + Pages. See [Collaboration & sync](https://plandesk.asyncdot.com/reference/collaboration/).

### Pending — Phase 6: multi-tenant hardening

What turns the collaboration tier into a true multi-tenant product. **Not yet built** — gated because a mistake here is a cross-tenant data leak (`tenant_isolation` is an unshippable-if-failing test):

- **Org / tenant model** — `orgs`, `org_members`, `project_members` on the hosted sync server.
- **Fail-closed tenant scoping** — every hosted query carries an `org_id` or throws; the raw DB client is unreachable outside the scoping module, so "forgot the `WHERE org_id`" cannot compile.
- **Intra-org project silos** — membership ACL so teams in one org only see projects they're shared into.
- **Per-audience revocation / expiry** — revoking one share invalidates its cached projection + open SSE without touching siblings.

(Agent-assisted self-deploy shipped in 0.4.0 as `plandesk deploy` — a hosted connector-spec an agent runs, not a bundled provisioner; see [RFC Delta 06](rfcs/client-collaboration-sync/06-c21-deploy-connector-delta.md).)

Smaller follow-ups: magic-link invite verification (current invite check trusts the typed email), cross-instance SSE pub/sub for multi-replica deploys, and `sync --watch` auto-reconnect.

## License

Private / see repository owner.
