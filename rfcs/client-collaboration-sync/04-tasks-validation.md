---
rfc: client-collaboration-sync
part: 04-tasks-validation
---

# 8. Incremental Task Breakdown

Six phases, each an end-to-end vertical slice that ships value and is independently demoable. Within a phase, chunks are independently committable.

## Phase 1 — Read-only portal

| ID  | Chunk                                                             | Files                                                                   | Grounding                          | Acceptance criteria                                                                               |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| C1  | `shares` table + share repo (local)                               | `packages/plandesk-db/src/{schema.ts,repositories/shares.ts}`           | REQ-5, REQ-11                      | create/get/list/revoke share rows; token hashed at rest                                           |
| C2  | `ClientView` projection (allow-list)                              | `packages/plandesk-api/src/projection.ts` (+test)                       | REQ-5, test:projection_no_internal | given a project, emits only shared tasks/edges/docs/progress; internal fields structurally absent |
| C3  | `ShareService`                                                    | `packages/plandesk-api/src/services/share.ts` (+test)                   | REQ-1, REQ-5                       | create/list/revoke + `buildClientView`                                                            |
| C4  | `@plandesk/sync-server` skeleton + projection store + portal read | `packages/plandesk-sync-server/**`                                      | REQ-12                             | `PUT projection` stores blob; `GET /view` returns it for a valid share token                      |
| C5  | Portal mode in web (read-only)                                    | `apps/plandesk-web/src/routes/p.$shareToken.tsx`, `lib/capabilities.ts` | REQ-8, A-UI-portal-read            | one app renders read-only canvas/board/docs from `/view`; no write affordances                    |

## Phase 2 — Join / identity

| ID  | Chunk                                           | Files                                                   | Grounding        | Acceptance criteria                                                        |
| --- | ----------------------------------------------- | ------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| C6  | `participants` + `activity_log` + join endpoint | `packages/plandesk-sync-server/src/{db,portal/join.ts}` | REQ-7, REQ-15    | `POST /join` with name → scoped participant session; logged                |
| C7  | Join UI (name gate) + session handling          | `apps/plandesk-web/src/routes/p.$shareToken.tsx`        | REQ-7, A-UI-join | guest enters name → sees view; identity shown                              |
| C8  | Invite-scope vs public mode                     | `share.ts`, `portal/join.ts`                            | REQ-7            | invite mode rejects non-invited email (403); public mode allows named join |

## Phase 3 — Issue intake (moderated)

| ID  | Chunk                                                | Files                                                         | Grounding                       | Acceptance criteria                                                            |
| --- | ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| C9  | `submissions` table + submit endpoint (rate-limited) | `packages/plandesk-sync-server/src/portal/submit.ts`          | REQ-1, test:submission_not_task | `POST /submissions` appends a `pending` submission; never creates/edits a task |
| C10 | Submit UI ("Add issue" on board)                     | `apps/plandesk-web/src/components/board/*` (capability-gated) | REQ-8, A-UI-submit              | participant with `submit` cap files an issue; appears in their submitted list  |

## Phase 4 — Pull / triage

| ID  | Chunk                                                                        | Files                                                                                                      | Grounding     | Acceptance criteria                                                                       |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| C11 | `SyncClient` pull + local triage inbox table                                 | `packages/plandesk-api/src/services/sync.ts`, `packages/plandesk-db/src/repositories/share-submissions.ts` | REQ-10        | `pull` is idempotent by `(participant, submission_id)`; rows land as `pending`            |
| C12 | Triage → accept into plan + ack-back                                         | `services/sync.ts` (uses `taskService.create`)                                                             | REQ-1         | accept creates a real task via existing write path; status acked to hosted                |
| C13 | CLI `publish/push/pull` + `.plandesk/config.json` extension                  | `packages/plandesk-cli/src/{sync.ts,connect-artifacts.ts}`                                                 | REQ-9, REQ-13 | publish writes global id + gitignored token; pull works offline-tolerant                  |
| C14 | MCP `publish_project/sync_push/sync_pull/list_submissions/triage_submission` | `packages/plandesk-mcp/src/tools/*`, `registry.ts`, `server.ts`                                            | REQ-2, REQ-14 | tools registered; `tools/list` count updated; no delete tool; agent can triage → scaffold |

## Phase 5 — Live status-back

| ID  | Chunk                                  | Files                                                | Grounding        | Acceptance criteria                                                  |
| --- | -------------------------------------- | ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| C15 | `watch` daemon: debounced push on SSE  | `services/sync.ts`, CLI `sync --watch`               | REQ-6            | a local `update_task` propagates to the pushed projection within ~2s |
| C16 | Hosted participant SSE (`GET /events`) | `packages/plandesk-sync-server/src/portal/events.ts` | REQ-6, A-UI-live | participant view updates in-progress→done with no refresh            |

## Phase 6 — Multi-tenant hardening (reviewer-gated)

| ID  | Chunk                                                                                                                                                                  | Files                                                                 | Grounding                           | Acceptance criteria                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| C17 | `orgs/org_members/project_members` + `tenantScoped` fail-closed repo                                                                                                   | `packages/plandesk-sync-server/src/db/tenant.ts` (+test)              | REQ-3, REQ-4, test:tenant_isolation | unscoped query throws; cross-org read returns 404                                                                              |
| C18 | Principal/token verifiers unify on `(tenant, principal, caps)`                                                                                                         | `packages/plandesk-shared/src/auth.ts`                                | REQ-2                               | all three token types resolve to a Principal; nothing global                                                                   |
| C19 | Intra-org project ACL (silos)                                                                                                                                          | `tenant.ts`, portal/sync routes                                       | REQ-4, test:project_membership      | non-member of a project within the same org gets 404                                                                           |
| C20 | Revocation + expiry invalidation                                                                                                                                       | `share.ts`, hosted shares + SSE                                       | REQ-11                              | revoke kills the next request + open SSE; other shares unaffected                                                              |
| C21 | `plandesk deploy` agent connector-spec (fetch+print, no bundled provisioner) — **see [Delta 06](06-c21-deploy-connector-delta.md)** for the reframe + chunks C21a–C21d | `packages/plandesk-cli/src/deploy.ts`, `apps/docs/public/deploy/*.md` | REQ-12                              | `deploy <target> --print` emits the hosted spec; an agent provisions into the user's repo+account; CLI ships no provider logic |

# 9. Validation and Testing

## 9.0 Validation Contract (assertion IDs)

| ID                          | Source | Assertion                                                                      |
| --------------------------- | ------ | ------------------------------------------------------------------------------ |
| REQ-1                       | §3     | A participant action can never create/edit an authored task/doc/status         |
| REQ-3                       | §3     | A hosted query without a tenant scope throws (fail closed)                     |
| REQ-4                       | §3     | Cross-org and non-member-project access both 404                               |
| REQ-5                       | §3     | No internal field/entity appears in any `ClientView`                           |
| REQ-6                       | §3     | Local change visible in participant view < 5s                                  |
| test:projection_no_internal | §9.1   | Projection of a project with agent runs + internal docs contains none of them  |
| test:submission_not_task    | §9.1   | Submitting an issue leaves task/edge/doc tables unchanged                      |
| test:tenant_isolation       | §9.1   | Principal(orgA) reading orgB's project → NotFound; unscoped repo call → throws |
| test:project_membership     | §9.1   | Member of orgX but not project P → 404 on P                                    |
| test:revocation             | §9.1   | Revoked share → 401 + projection blob unreadable; sibling share still 200      |
| test:pull_idempotent        | §9.1   | Pulling the same submission twice yields one triage row                        |
| A-UI-portal-read            | §9     | Browser: guest opens link, sees read-only canvas/board, no edit handles        |
| A-UI-join                   | §9     | Browser: name gate → identified session                                        |
| A-UI-submit                 | §9     | Browser: guest files an issue; owner sees it after `pull`                      |
| A-UI-live                   | §9     | Browser: owner sets task in_progress → guest view updates without refresh      |

## 9.1 Fail-to-Pass Tests

- `projection_no_internal`, `submission_not_task`, `tenant_isolation`, `project_membership`, `revocation`, `pull_idempotent` (names above).
- `share_service_build_client_view`, `sync_publish_writes_config`, `triage_accept_creates_task`.

## 9.2 Regression (Pass-to-Pass)

- Full existing suite: `pnpm test` (db/api/mcp/cli/web). The 18 MCP tools' `tools/list` assertion updated to the new count; no existing tool altered.
- `pnpm build && pnpm lint` green.

## 9.3 Validation Commands

```bash
# Tenant isolation must FAIL CLOSED (this is the gate for Phase 6)
pnpm --filter @plandesk/sync-server test -t "tenant_isolation"

# Projection leak check: build a ClientView, assert no internal keys
pnpm --filter @plandesk/api test -t "projection_no_internal"

# End-to-end portal read (against a local sync-server + seeded share token)
TOKEN=...; curl -s "$SYNC/api/portal/v1/shares/$TOKEN/view" | jq 'has("agent_runs") | not'   # => true

# Submission never mutates source of truth
curl -s -X POST "$SYNC/api/portal/v1/shares/$TOKEN/submissions" -d '{"title":"bug","body":"x"}' >/dev/null
sqlite3 workspace.db "SELECT count(*) FROM tasks;"   # unchanged vs pre-submit
```
