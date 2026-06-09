---
rfc: client-collaboration-sync
part: 02-requirements-interfaces
---

# 3. Strict Requirements

- **REQ-1 (Moderated proposals).** Participant contributions are append-only proposals into a moderated inbox. They MUST NOT mutate authored entities (tasks, edges, documents, statuses) directly. A submission becomes real work only when the owner explicitly accepts it.
- **REQ-2 (Token taxonomy).** Exactly three token types, each resolving to a `(tenant, principal, capabilities)` tuple. No global or unscoped token exists.
  - MCP token: agent ↔ local server (existing).
  - Sync token: local instance ↔ hosted, scoped to `(org, project)`.
  - Participant token: client ↔ a single share, scoped to `(org, project, share, participant)`.
- **REQ-3 (Fail-closed tenant scoping).** Every hosted data-access call MUST carry a tenant (`org_id`) derived from the authenticated principal. The hosted data layer MUST refuse to execute a query without a tenant scope (fail closed, not open). A missing scope is a thrown error, never an unfiltered read.
- **REQ-4 (Two-layer access control).** (a) Org isolation: a principal in org A can never reach any entity in org B. (b) Intra-org project membership: within an org, a principal can access only projects they are a member of or explicitly shared into. Both layers apply to every hosted read and write.
- **REQ-5 (Allow-list egress projection).** The `ClientView` projection is allow-list, not deny-list: only entities and fields explicitly marked shared are serialized. Internal entities (agent runs, internal documents, internal comments, tokens, assignees unless explicitly shared) MUST be structurally absent from any projection — not filtered at read time, but never serialized.
- **REQ-6 (Live).** Projection updates MUST stream to connected participants over a filtered channel derived from the existing SSE bus, without a manual re-publish, with end-to-end visible latency under 5s under normal conditions.
- **REQ-7 (Named identity + audit).** A participant joins a share by providing a name (and optional email), receiving a scoped session. Every participant action (join, view, submit, comment) MUST be attributed to that participant and recorded in a per-share, append-only activity log.
- **REQ-8 (Single capability-driven frontend).** One web app codebase serves owner, hosted team member, and guest participant. The frontend renders affordances based on the principal's capabilities but enforces NOTHING; the server (projection boundary + capability check + tenant scope) is the sole enforcement boundary.
- **REQ-9 (Global project identity).** On publish, a project receives a stable global ID assigned by the hosted server. Local↔hosted sync references the global ID. The mapping and sync token are stored in `.plandesk/config.json` (token gitignored). Re-publish is idempotent.
- **REQ-10 (Git-remote sync).** Sync is explicit `push`/`pull` exposed as CLI commands and MCP tools, plus an optional `--watch` daemon for live outbound. `pull` is idempotent: submissions are append-only events keyed by `(participant, submission_id)`; there is no two-way merge of the source of truth.
- **REQ-11 (Lifecycle).** Shares and tokens support expiry and revocation. Revocation is immediate: the next participant request fails and any cached projection for that share is invalidated. Revoking one audience MUST NOT affect another.
- **REQ-12 (Portable, self-deployable server).** The hosted sync server is a single portable deployable artifact. Agent-assisted self-deploy MUST be supported: target selection, local-tooling detection (`wrangler`/`flyctl`/`docker`), provisioning, and token wiring. **Refined by [Delta 06](06-c21-deploy-connector-delta.md): agent-assisted via a hosted deploy-spec registry, not a bundled imperative provisioner — the CLI fetches+prints a spec, the agent executes it.** Cross-org isolation MAY be satisfied by separate deployments.
- **REQ-13 (Local-first preserved).** Local authoring and agent execution MUST remain fully functional offline. Sync is additive; the local tool MUST NOT depend on the hosted server to author or execute.
- **REQ-14 (No regression).** The existing single-user REST behavior, the 18 MCP tools, the service-layer-as-sole-write-path invariant, and the SSE taxonomy MUST be preserved.
- **REQ-15 (Minimal participant PII).** The hosted server stores the minimum participant data needed for attribution (name, optional email, session). PII is encryptable at rest and subject to per-share retention/expiry.

# 4. Interface Specification

## 4.1 Token taxonomy (shared types)

- **Location:** `packages/plandesk-shared/src/auth.ts` (new shared package, or `packages/plandesk-db` if kept DB-adjacent)
- **Type:** `type Principal = { orgId: string; kind: 'agent' | 'member' | 'participant'; subjectId: string; capabilities: Capability[] }`
- **Behavior:** Every token verifier (`verifyMcpToken`, `verifySyncToken`, `verifyParticipantSession`) returns a `Principal` or `undefined`. Hosted handlers derive `orgId` only from the verified `Principal`, never from request input.
- **Error cases:** unknown/expired/revoked token → `undefined` → 401. A handler that reaches the data layer without a `Principal` is a programming error → 500 (and a test must prove it can't happen on authed paths).

## 4.2 `ShareService` (local, in `@plandesk/api`)

- **Location:** `packages/plandesk-api/src/services/share.ts` (+ `share.test.ts`)
- **Signatures:**
  - `createShare(projectId: string, input: { audienceName: string; mode: 'invite' | 'public'; emails?: string[]; permissions: SharePermissions; expiresAt?: Date }) -> SerializedShare`
  - `buildClientView(projectId: string, shareId: string) -> ClientView`
  - `revokeShare(shareId: string) -> boolean`
  - `listShares(projectId: string) -> SerializedShare[]`
- **Behavior:** `buildClientView` is the **only** function that produces participant-visible bytes; it walks the project and emits an allow-listed `ClientView` (project meta, shared tasks with safe fields, edges among shared tasks, shared documents, progress summary, share/permissions). It has no code path that can read internal entities.
- **Error cases:** missing project/share → `undefined`/`false`; invalid permissions → `InvalidShareError` → 400.

## 4.3 `ClientView` (projection shape)

- **Location:** `packages/plandesk-api/src/projection.ts`
- **Type (allow-list):**
  ```
  ClientView = {
    project: { global_id, name, description?, updated_at },
    tasks: Array<{ id, label, status, due_date?, position }>,   // NO assignee/internal description unless permission grants
    edges: Array<{ from, to, label }>,                          // only among shared tasks
    documents: Array<{ id, title, body_html, updated_at }>,     // only docs marked shared
    progress: { todo, in_progress, done, ... },
    share: { audience_name, permissions, expires_at? },
  }
  ```
- **Behavior:** pure function of `(project rows, share policy)`. Whatever is not in this type cannot reach a participant.

## 4.4 Sync client (local, in `@plandesk/api` + `@plandesk/cli`)

- **Location:** `packages/plandesk-api/src/services/sync.ts`, CLI in `packages/plandesk-cli/src/sync.ts`
- **Signatures:**
  - `publishProject(projectId: string, remote: SyncRemote) -> { globalId: string }` — registers the project on the hosted server, persists `{ globalId, syncToken, serverUrl }` into `.plandesk/config.json`.
  - `push(projectId: string) -> { pushedVersion: number }` — builds `ClientView` per active share, PUTs to hosted.
  - `pull(projectId: string, sinceCursor?: string) -> Submission[]` — GETs new submissions, materializes them as local triage-inbox rows (proposals).
  - `ackSubmission(submissionId: string, state: 'accepted' | 'rejected' | 'in_progress' | 'done') -> void` — pushes triage state back so participants see it.
  - `watch(projectId: string) -> Disposable` — subscribes to the local SSE bus; debounced `push` on change.
- **Error cases:** hosted unreachable → typed `SyncUnavailableError`; local authoring continues uninterrupted (REQ-13). Token revoked → `SyncUnauthorizedError` → prompt re-publish.

## 4.5 Hosted sync server (`@plandesk/sync-server`, new package)

- **Location:** `packages/plandesk-sync-server/` (Hono app; portable across Workers/Node/Docker)
- **Endpoints (all tenant-scoped via the verified `Principal`):**
  - `POST /api/sync/v1/projects` (sync token) → assign/return `global_id`.
  - `PUT /api/sync/v1/projects/:gid/projection` (sync token) — store the pushed `ClientView`s; fan SSE to participants.
  - `GET /api/sync/v1/projects/:gid/submissions?since=` (sync token) — return submissions after cursor.
  - `POST /api/sync/v1/projects/:gid/submissions/:id/ack` (sync token) — record triage state.
  - `POST /api/portal/v1/shares/:token/join` (share token) → create named participant session; log.
  - `GET /api/portal/v1/shares/:token/view` (participant session) → serve stored `ClientView`.
  - `GET /api/portal/v1/shares/:token/events` (participant session) → SSE filtered to this share.
  - `POST /api/portal/v1/shares/:token/submissions` (participant session) → append moderated submission; log; rate-limited.
- **Error cases:** unknown/expired/revoked token → 401; tenant/project mismatch → 404 (never 403 that confirms existence); rate-limit exceeded → 429; missing tenant scope at the data layer → 500 + alert (must be unreachable on authed paths).

## 4.6 MCP tools (agent-operable sync)

- **Location:** `packages/plandesk-mcp/src/tools/{publish-project,sync-push,sync-pull,list-submissions,triage-submission}.ts` + `registry.ts` + `server.ts`
- `publish_project { project_id, remote_url }` → `{ global_id }`
- `sync_push { project_id }` / `sync_pull { project_id }`
- `list_submissions { project_id, status? }` → pending triage proposals
- `triage_submission { submission_id, action: 'accept' | 'reject', as_task? }` → on accept, calls `taskService.create` (existing) and `ackSubmission`. No new delete tool (RFC §10 boundary preserved).

## 4.7 CLI surface

```
plandesk publish --project <id> --remote <url>      # register + first push; writes .plandesk/config.json
plandesk push [--project <id>]                       # publish projection(s)
plandesk pull [--project <id>]                       # fetch submissions into triage inbox
plandesk sync --watch [--project <id>]               # live outbound daemon
plandesk share create --project <id> --audience "Acme" [--invite a@b.com] [--public] [--expires 30d]
plandesk share list|revoke ...
plandesk deploy [cloudflare|fly|docker] [--print]    # fetch the hosted deploy spec for a coding agent (| claude); see Delta 06
```

# 5. Architecture and System Dependencies

## 5.1 Structural changes

```
            LOCAL (source of truth, offline-capable)            HOSTED (rendezvous; multi-tenant; NOT source of truth)
  +---------------------------------------------+        +-------------------------------------------------+
  | @plandesk/api                               |        | @plandesk/sync-server (Hono, portable)          |
  |  services/: project, task, canvas, document |  push  |  /api/sync/v1/*   (sync token, owner side)       |
  |  + share.ts (buildClientView)               | =====> |  /api/portal/v1/* (participant token, client)   |
  |  + sync.ts  (publish/push/pull/watch)       |  pull  |  tenant-scoped repo (fail-closed)               |
  |  events.ts (SSE)  -> filtered projection    | <===== |  tables: orgs, org_members, projects(global),    |
  | @plandesk/cli: publish/push/pull/share/deploy|       |    project_members, shares, participants,         |
  | @plandesk/mcp: publish_project/sync_*/triage |       |    submissions, projection_blobs, activity_log   |
  +---------------------------------------------+        +-------------------------------------------------+
            ^                                                         ^
            | MCP token (agent)                                      | participant token (named client/team member)
        coding agent                                            ONE capability-driven web app (owner | member | guest)
```

- New packages: `@plandesk/sync-server` (hosted), optional `@plandesk/shared` (token/principal/projection types shared local↔hosted).
- `@plandesk/api`: add `share.ts`, `sync.ts`, `projection.ts`.
- `apps/plandesk-web`: add a capability layer + a `portal` route/mode (read view + join + submit) reusing existing canvas/board/doc components in read-only.
- `@plandesk/cli`, `@plandesk/mcp`: new commands/tools above.

## 5.2 Service and library dependencies

- Hono (already used by api), Drizzle ORM (hosted store). Hosted store target chosen per deploy: libSQL/SQLite (Turso) or Cloudflare D1 (SQLite-compatible — keeps the Drizzle schema portable from local) with a Postgres adapter option.
- Deploy CLIs for self-deploy: `wrangler` (Cloudflare), `flyctl` (Fly), `docker`. Detected, not bundled.

## 5.3 Data and schema changes

- **Local (new tables in `@plandesk/db`):** `shares`, `share_submissions` (pulled proposals, with `status` triage state), and a `sync_remotes` row (or fields in config) for `{ global_id, server_url, sync_token_hash }`.
- **Hosted (new schema in `@plandesk/sync-server`):** `orgs`, `org_members`, `projects` (global id, org_id), `project_members`, `shares`, `participants`, `submissions`, `projection_blobs`, `activity_log`. **Every hosted table carries `org_id`** and is reached only through a tenant-scoped repository (see Part 03 §7).
- **`.plandesk/config.json` extension:** add `remote: { serverUrl, globalProjectId }`; the sync token goes to `.plandesk/token` (gitignored), matching the existing connect pattern.

## 5.4 Network and performance

- Outbound: debounced projection push (coalesce SSE bursts; target push within ~1–2s of a change). Inbound: participant SSE for live view; submissions rate-limited per session/IP.
- Revocation invalidates the share's stored projection + open SSE connections.
- For v1, participant liveness is SSE over the stored projection (re-pushed on change); a WebSocket/Durable-Object delta transport is a later optimization (Part 05 Q5).
