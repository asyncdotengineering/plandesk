---
rfc: client-collaboration-sync
part: README
---

# RFC: Client Collaboration & Multi-Tenant Sync

**Category:** Architectural Change
**Author:** mithushancj
**Date:** 2026-06-09
**Status:** Draft
**Reviewers:** TBD
**Related:** `apps/docs/src/content/docs/connecting-agents/skill.md`, `packages/plandesk-api/src/events.ts`, `packages/plandesk-db/src/schema.ts`, `packages/plandesk-cli/src/connect-artifacts.ts`, the prior 5-part Plan Desk RFC (`../../../plandesk-rfc/`)

---

## Summary

Plan Desk is a local-first, single-user planning workspace. This RFC turns it into a product where a local-first **authoring instance** syncs (git-remote `push`/`pull` model) with a **hosted sync server**, so external clients — and other internal teams, in silos — can join a project via a named-participant link, watch curated **live** status (including what's in progress), and submit issues into a **moderated inbox**. The owner pulls submissions down, triages them into the real plan, and the agent executes; status flows back out. The hosted layer is designed **multi-tenant with fail-closed isolation from day one**, distributed primarily by **agent-assisted self-deploy**.

The load-bearing invariant: **a participant never writes to the source of truth, and never sees across a tenant or project boundary.** Both are enforced server-side by construction (allow-list egress projection + tenant-scoped, fail-closed data access), never by the client.

## Navigation

| Part | Sections | Contents |
|------|----------|----------|
| [01-problem-background](./01-problem-background.md) | 1–2 | Problem statement, current-state grounding, rejected alternatives |
| [02-requirements-interfaces](./02-requirements-interfaces.md) | 3–5 | REQ-1..REQ-15, interface specs, architecture, schema, token taxonomy |
| [03-pseudocode-blueprint](./03-pseudocode-blueprint.md) | 6–7 | Publish/push/join/submit/pull/triage flows; tenant-scoping blueprint |
| [04-tasks-validation](./04-tasks-validation.md) | 8–9 | Phased WBS (6 phases), validation contract, isolation & leak tests |
| [05-security-rollback-open-qs](./05-security-rollback-open-qs.md) | 10–12 | Threat/privacy model, rollback, open questions (with proposals) |

## The six phases (each a vertical slice)

1. **Read-only portal** — `ShareService` + allow-list `ClientView` projection + portal read endpoints + capability-driven portal mode in the existing web app.
2. **Join / identity** — named-participant sessions (Zoom-style join) + per-share activity/audit log.
3. **Issue intake** — moderated submission inbox on the hosted server + participant submit UI.
4. **Pull / triage** — `SyncClient` pull → local triage inbox → accept-into-plan → ack-back; MCP `list_submissions` / `triage_submission`.
5. **Live status-back** — filtered SSE projection stream + push-on-change daemon so participants see in-progress/done live.
6. **Multi-tenant hardening** — org/tenant model, fail-closed scoping, intra-org project ACL (silos), agent-assisted self-deploy, revocation/expiry.

## Open-question status

7 open questions, **all carry a committed `**Proposal:**`** (see Part 05). The two the author raised directly — single capability-driven frontend (Q4) and agent-assisted self-deploy as primary distribution (Q2/Q6) — are proposed as committed. Phase 6 (multi-tenant) is flagged reviewer-gated before execution given its blast radius.
