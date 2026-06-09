---
rfc: client-collaboration-sync
part: 01-problem-background
---

# 1. Problem Statement

Plan Desk is local-first and single-user. A project lives in one SQLite workspace on the owner's machine, served on `127.0.0.1`. There is **no way to share a project with an external client or another internal team** — no read view, no feedback channel, no identity, no isolation. Today, getting a client's bug report into the plan is an out-of-band manual chore (email → re-type into the board), and the client has zero visibility into whether it's being worked on.

We want client collaboration to be a **native, first-class capability** without giving up local-first authoring or data sovereignty, and architected so it can serve **multiple teams in silos** if Plan Desk graduates from an internal tool to a product.

**Success is concretely:**

- A named participant opens a share link, joins (name + optional email), and sees a **curated, live** view of a project — including which tasks are `in_progress` — within seconds of changes, with no page refresh.
- That participant can **file an issue/bug** that lands in a moderated inbox, attributed to them and recorded in an audit log; it **never** mutates the owner's tasks directly.
- The owner runs `plandesk pull`, the issue appears as a triage proposal, they accept it into the graph, the agent works it (existing `scaffold`/`get_next_task` loop), and its status flows back out to the participant.
- A principal **cannot, under any code path, read a project outside their org or a project within their org they are not a member of** — verified by an isolation test that must fail closed.
- The local tool keeps working fully offline; sync is additive and never blocks authoring or agent execution.

# 2. Background

## 2.1 Current state (grounded)

- **Single-user, no tenancy.** Projects are keyed by a local UUID (`packages/plandesk-db/src/schema.ts` `projects`). REST under `/api/v1` is open on localhost; there is no org/workspace/user concept and no per-project access control.
- **MCP auth = sha256 bearer tokens.** `mcp_tokens` (`schema.ts`) stores `token_hash`; `createToken` returns the raw token once and `verifyToken` checks the hash. This hashed-at-rest, shown-once pattern is the template for the two **new** token types this RFC introduces (sync, participant).
- **SSE bus already exists.** `packages/plandesk-api/src/events.ts` emits `task_updated`, `canvas_updated`, `document_created`, `comment_created`, `comment_updated`, `agent_run_*`. Services are the only write path and the only emitters (architecture invariant). The participant **live projection** subscribes to a _filtered_ derivative of this bus — no new write path.
- **Comments model exists.** `document_comments` (`schema.ts` — `document_id`, `passage`, `body`, `resolved`) plus `commentService` (create/list/resolve) and MCP `list_comments`/`add_comment`/`resolve_comment`. Participant-submitted issues and comments reuse this shape on a clearly-external channel rather than inventing a parallel model.
- **Repo binding config exists.** `plandesk connect` writes `.plandesk/config.json` = `{ version, serverUrl, projectId, projectName }` (`packages/plandesk-cli/src/connect-artifacts.ts`). This RFC **extends** that file with the hosted remote, the global project ID, and the sync token — the same idempotent, commit-safe pattern (token gitignored).
- **Lossless projection basis exists.** `plandesk export`/`import` (`plandesk-export-v1`) already walks a project into a serializable shape; the `ClientView` projection is a _filtered, allow-listed_ descendant of that work, not a greenfield serializer.
- **Self-host + edge deploy already in the toolchain.** The web/docs ship via Docker and Cloudflare (wrangler is wired and used in this repo's docs deploys). The hosted sync server is a sibling deployable artifact reusing this muscle.
- **One web app.** `apps/plandesk-web` is a single React 19 + Vite + TanStack Router/Query SPA talking to `/api/v1`. It is feasible to make it **capability-driven** so the same bundle serves owner, hosted team member, and guest participant — gating UX on capabilities while the server enforces.

## 2.2 Why not the two obvious shapes

These were considered and rejected (recorded so reviewers don't re-litigate):

- **Live public API on the owner's instance.** Truly live, but forces the local-first machine to accept **inbound** public connections (tunnel / always-on box). Laptop closes → client sees nothing. Worse, filtering internal data _on read_ at a public endpoint means one projection bug leaks real data. Rejected: breaks local-first reachability and is the weaker security posture.
- **Static snapshot export.** Email an HTML/JSON blob. Stale the instant anything changes, and no two-way channel. Rejected: it is the workaround, not the capability.

The chosen shape — **outbound projection push + hosted rendezvous + moderated inbound inbox** — is live (continuous push), preserves local-first (the machine only pushes _out_; it never accepts inbound to the source of truth), and is secure by construction (only allow-listed bytes ever egress; untrusted input lands in a moderated inbox, never the source of truth).

## 2.3 Magnitude (honest framing)

This crosses Plan Desk from a local-first single-user tool into **local-first core + an explicitly opt-in, multi-tenant hosted collaboration tier**. That tier carries obligations the local tool never had: uptime, authn/authz, tenant-isolation correctness, abuse handling, and client-PII privacy. The discipline this RFC adopts: **design the boundary (data model, tenant scoping, sync protocol, token taxonomy) for the multi-tenant end-state now — it is near-free up front and brutal to retrofit — while deferring the SaaS _business_ machinery (billing, admin consoles, self-serve onboarding) until there is demand.**
