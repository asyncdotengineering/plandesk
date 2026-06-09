---
rfc: client-collaboration-sync
part: 05-security-rollback-open-qs
---

# 10. Security Considerations

This feature introduces Plan Desk's first untrusted-input, multi-tenant, publicly-reachable surface. The threat model is the core of the RFC, not an appendix.

## 10.1 Tenant isolation (highest severity)

- **Fail-closed scoping (REQ-3).** Every hosted query flows through `tenantScoped(principal)` (Part 03 §7.1), which throws without an `org_id`. The raw DB client is not importable outside `db/tenant.ts` (module boundary + lint rule), so "forgot the `WHERE org_id`" cannot compile into a portal/sync route. `test:tenant_isolation` and `test:project_membership` are **ship gates** — a failure blocks release (Part 11).
- **No existence oracle.** Cross-org and non-member access return `404`, never `403`, so a probe can't confirm a project exists in another tenant.
- **Tenant derives from the token only.** `org_id` is read from the verified `Principal`, never from request path/body. A participant cannot escalate by changing an ID in the URL — their session is bound to `(org, project, share)`.

## 10.2 Egress projection (data exfiltration)

- **Allow-list, not deny-list (REQ-5).** Only fields in the `ClientView` type can ever leave the local instance. Agent runs, tokens, internal docs/comments, assignees (unless granted) are **never serialized** — adding a new internal table later cannot leak because nothing references it in `buildClientView`. `test:projection_no_internal` enforces this.
- **The only bytes on the hosted server are already client-safe.** Because projection happens at egress on the local side, the hosted store never holds internal data. A breach of the hosted server exposes only what was already shared with clients — a structurally smaller blast radius than a public API that filters on read.

## 10.3 Untrusted contribution (integrity)

- **Moderated inbox (REQ-1).** Participant submissions are append-only `pending` rows. They cannot create/edit/delete tasks, edges, docs, or statuses. `test:submission_not_task` enforces. Real work is created only by the owner/agent via the existing `taskService` write path on `accept`.
- **Input hardening.** Submission `body` is sanitized; rendered doc HTML is sanitized (reuse the web app's existing DOMPurify path). Size limits + content-type validation on submit.

## 10.4 Identity, abuse, PII

- **Capability tokens (REQ-2).** All three token types are high-entropy, sha256-hashed at rest, shown once — the existing `mcp_tokens` pattern. Sessions are scoped, expiring, revocable.
- **Spam/abuse.** Public-link join is the weak-trust mode; default is **invite-scoped** (email allow-list → the named join must match). Rate-limit join + submit per session/IP; the moderated inbox means abuse never reaches the plan; optional CAPTCHA on public mode.
- **Participant PII (REQ-15).** Store the minimum (name, optional email). Encrypt at rest; per-share retention/expiry; revocation purges sessions. For self-hosted deployments the operator owns the data; for any hosted-convenience tier, a privacy policy + DPA is a precondition (out of scope for build, in scope for launch).
- **Audit (REQ-7).** Append-only `activity_log` of join/view/submit per share — accountability for client work and an intrusion trail.

## 10.5 Transport & deploy

- HTTPS only on the hosted surface; the local authoring surface stays bound to `127.0.0.1` (REQ-13) — the portal is the _only_ publicly reachable surface.
- Self-deploy provisions least-privilege store credentials; the bootstrap sync token is shown once and stored gitignored.

# 11. Rollback and Abort Criteria

- **Sync is additive and feature-flagged.** With sync disabled or the hosted server unreachable, local authoring + agent execution are unchanged (REQ-13). Rollback = disable the sync remote; the local workspace is untouched (it is the source of truth).
- **Hard-stop abort conditions (do not ship):**
  - `test:tenant_isolation` or `test:project_membership` fails → **STOP**. A tenant leak is never shippable; re-architect the scoping, do not patch the symptom.
  - `test:projection_no_internal` fails → **STOP**. Internal data reached a projection.
  - Any path where a participant action mutates an authored entity (`test:submission_not_task` fails) → **STOP**.
- **Rollback procedure:** flip the sync feature flag off → portal endpoints 404, local unaffected. Revoke outstanding share/sync tokens. Pulled triage rows are local-only and harmless; published projection blobs are deleted on share revocation.

# 12. Open Questions

- **Q1 — Hosted store technology.** Tradeoff: Cloudflare D1 / libSQL (SQLite-compatible, keeps the Drizzle schema portable from local, cheap, edge-native) vs Postgres (richer, heavier ops).
  **Proposal:** SQLite-compatible (D1 or libSQL/Turso) for v1 so the hosted schema mirrors local Drizzle and self-deploy is trivial; keep a Postgres adapter seam for large self-hosters.

- **Q2 — First self-deploy target.** Tradeoff: Cloudflare Workers+D1 (wrangler already wired in this repo) vs Fly/Docker (closer to existing self-host image) first.
  **Proposal:** Cloudflare Workers+D1 first (lowest friction, already in the toolchain), Docker/Fly second. `plandesk deploy` detects tooling and supports both.

- **Q3 — Default identity strength.** Tradeoff: open "type any name to join" (frictionless, weak trust) vs invite-scoped magic link (verified, slightly more setup).
  **Proposal:** Invite-scoped default for client work; open-join is an explicit per-share "public feedback" opt-in.

- **Q4 — One frontend vs separate portal build.** Tradeoff: single capability-driven app (DRY, one codebase) vs a separate tree-shaken portal bundle (smaller client download, less API-shape disclosure).
  **Proposal (author-confirmed):** One capability-driven app now; the server is the enforcement boundary, so a guest holding the bundle gains nothing (calls 401/404). Extract a tree-shaken portal build later only if bundle size or info-disclosure measurably warrants — defense-in-depth, not an architectural fork.

- **Q5 — Participant live transport.** Tradeoff: SSE over re-pushed projection (simple, reuses existing bus) vs WebSocket/Durable-Object deltas (instant, more infra).
  **Proposal:** SSE/re-push for v1 (meets REQ-6's <5s); WS/DO delta transport is a later performance optimization.

- **Q6 — Central hosted tier vs self-deploy only.** Tradeoff: Plan-Desk-operated multi-tenant SaaS (frictionless onboarding, monetizable, but full SaaS obligations) vs agent-assisted self-deploy only (sovereignty, physical cross-org isolation, no central liability).
  **Proposal (author-confirmed):** Self-deploy first as primary distribution; a hosted-convenience tier is an optional future running the same `@plandesk/sync-server` artifact. Cross-org isolation via separate deployments; intra-org silos via project ACL.

- **Q7 — Submission conflict/merge model.** Tradeoff: two-way merge of client edits vs append-only proposals.
  **Proposal:** Append-only, idempotent submissions keyed by `(participant, submission_id)`; the source of truth is never merged into — only the owner's `accept` creates authored state (already REQ-1/REQ-10).
