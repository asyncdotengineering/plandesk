---
rfc: client-collaboration-sync
part: 03-pseudocode-blueprint
---

# 6. Pseudocode

## 6.1 Fail-closed tenant scoping (the load-bearing primitive)

```
# Every hosted data access goes through this. There is no other way to query.
FUNCTION tenantScoped(principal):
    IF principal IS NULL OR principal.orgId IS NULL:
        THROW TenantScopeMissing            # fail CLOSED — never returns an unscoped handle
    RETURN repo bound to WHERE org_id = principal.orgId   # every query auto-filters by org

FUNCTION assertProjectAccess(principal, projectGlobalId):
    project = tenantScoped(principal).projects.get(projectGlobalId)   # org filter already applied
    IF project IS NULL: THROW NotFound                                 # 404, not 403 (no existence oracle)
    IF principal.kind == 'member' AND NOT isMember(principal, project): THROW NotFound
    RETURN project
```

## 6.2 Publish (owner, one-time per project)

```
FUNCTION publishProject(projectId, remote):
    principal = verifySyncToken(remote.syncToken)        # -> (org, agent/member, caps)
    globalId  = remote.POST('/api/sync/v1/projects', { name })   # hosted assigns within principal.org
    writeConfig('.plandesk/config.json', { remote: { serverUrl, globalProjectId: globalId } })
    writeTokenFile('.plandesk/token', remote.syncToken)  # gitignored
    push(projectId)                                       # initial projection
    RETURN globalId
```

## 6.3 Push projection (owner; live via watch)

```
FUNCTION push(projectId):
    remote = readRemote(projectId)
    FOR share IN ShareService.listShares(projectId) WHERE active:
        view = ShareService.buildClientView(projectId, share.id)   # ALLOW-LIST projection only
        remote.PUT('/api/sync/v1/projects/{gid}/projection',
                   { shareId: share.id, version: nextVersion(), view })
    # hosted side stores the blob and fans an SSE 'projection_updated' to that share's participants

FUNCTION watch(projectId):
    SUBSCRIBE localEventBus:                # task_updated/canvas_updated/document_created/comment_*
        ON event WHERE event.projectId == projectId:
            debounce(1500ms): push(projectId)
```

## 6.4 Participant join (Zoom-style)

```
FUNCTION joinShare(shareToken, { name, email }):
    share = hosted.shares.byToken(hash(shareToken))      # tenant resolved from the share row's org_id
    IF share IS NULL OR share.revoked OR share.expired: RETURN 401
    IF share.mode == 'invite' AND email NOT IN share.invited_emails: RETURN 403
    participant = hosted.participants.create({ orgId: share.orgId, shareId: share.id, name, email })
    session = issueParticipantSession(participant)        # scoped (org, project, share, participant)
    activityLog.append(share, participant, 'join')
    RETURN session
```

## 6.5 Participant view + submit

```
FUNCTION getView(session):
    principal = verifyParticipantSession(session)         # -> (org, participant, caps=[read, maybe submit])
    assertCap(principal, 'read')
    activityLog.append(principal.share, principal, 'view')
    RETURN hosted.projectionBlobs.latest(principal.shareId)   # the pushed ClientView; nothing computed live from internal data

FUNCTION submit(session, { title, body, severity?, taskRef? }):
    principal = verifyParticipantSession(session)
    assertCap(principal, 'submit')
    rateLimit(principal)                                  # 429 on abuse
    submission = hosted.submissions.create({
        orgId: principal.orgId, projectGlobalId: principal.projectGlobalId,
        participantId: principal.subjectId, title, body, severity, taskRef,
        status: 'pending' })                              # MODERATED INBOX — not a task
    activityLog.append(principal.share, principal, 'submit', submission.id)
    RETURN submission.id
```

## 6.6 Pull + triage (owner; agent-operable)

```
FUNCTION pull(projectId):
    remote = readRemote(projectId)
    cursor = readPullCursor(projectId)
    submissions = remote.GET('/api/sync/v1/projects/{gid}/submissions?since={cursor}')
    FOR s IN submissions:                                 # idempotent by (participant, submission_id)
        upsertLocalTriageRow(projectId, s, status='pending')
    writePullCursor(projectId, max(submissions.cursor))
    RETURN submissions

FUNCTION triage(submissionId, action, asTask?):
    row = localTriage.get(submissionId)
    IF action == 'accept':
        task = taskService.create(row.projectId, asTask ?? deriveTask(row))   # existing write path; emits SSE
        localTriage.update(submissionId, status='accepted', linkedTaskId=task.id)
        ackSubmission(submissionId, 'accepted')           # status flows back to participant
    ELSE:
        localTriage.update(submissionId, status='rejected')
        ackSubmission(submissionId, 'rejected')
```

## 6.7 Agent-assisted self-deploy

```
FUNCTION deploy(target?):
    target = target ?? ASK_USER('Where should the sync server live? [cloudflare|fly|docker|custom]')
    tool   = { cloudflare:'wrangler', fly:'flyctl', docker:'docker' }[target]
    IF NOT which(tool): GUIDE_USER_TO_INSTALL(tool); RETURN
    store  = provisionStore(target)        # D1 / libSQL / volume
    url    = deployArtifact(target, store) # publishes @plandesk/sync-server
    orgTok = bootstrapOrgAndSyncToken(url) # creates org #1, returns a sync token
    PRINT('Deployed: ' + url + '  — run: plandesk publish --project <id> --remote ' + url)
    RETURN url
```

# 7. Code Blueprint

## 7.1 Tenant-scoped repository (hosted) — fail closed by construction

```ts
// packages/plandesk-sync-server/src/db/tenant.ts
export class TenantScopeMissing extends Error {}

export function tenantScoped(principal: Principal | undefined) {
  if (!principal?.orgId) throw new TenantScopeMissing(); // unscoped access is impossible
  const org = eq(schema.someTable.orgId, principal.orgId);
  return {
    projects: {
      get: (gid: string) =>
        db
          .select()
          .from(projects)
          .where(and(eq(projects.globalId, gid), eq(projects.orgId, principal.orgId)))
          .get(),
      // ...every method folds the org predicate in; there is no raw `db` exported from this module
    },
    submissions: {
      /* ... org-scoped ... */
    },
    // ...
  };
}
```

The portal/sync route modules import only `tenantScoped`, never the raw `db`. A lint rule (or module boundary) forbids importing the raw client outside `tenant.ts`, so "forgot the WHERE org_id" is structurally impossible on these surfaces.

## 7.2 Allow-list projection (local)

```ts
// packages/plandesk-api/src/projection.ts
export function buildClientView(db: Db, projectId: string, share: Share): ClientView {
  const project = getProject(db, projectId)!;
  const policy = share.policy; // which tasks/docs are shared, which fields
  const sharedTasks = listTasks(db, projectId)
    .filter((t) => policy.includesTask(t))
    .map((t) => ({
      id: t.id,
      label: t.label,
      status: t.status,
      due_date: iso(t.dueDate),
      position: { x: t.x, y: t.y },
    }));
  const ids = new Set(sharedTasks.map((t) => t.id));
  const edges = listEdges(db, projectId)
    .filter((e) => ids.has(e.fromTaskId) && ids.has(e.toTaskId))
    .map((e) => ({ from: e.fromTaskId, to: e.toTaskId, label: e.label }));
  const docs = listDocuments(db, projectId)
    .filter((d) => policy.sharesDoc(d.id))
    .map((d) => ({
      id: d.id,
      title: d.title,
      body_html: sanitize(d.body),
      updated_at: iso(d.updatedAt),
    }));
  // agent runs, internal comments, tokens, assignees: NEVER referenced here — not filtered, absent.
  return {
    project: projMeta(project),
    tasks: sharedTasks,
    edges,
    documents: docs,
    progress: summarize(sharedTasks),
    share: shareMeta(share),
  };
}
```

## 7.3 Capability-driven frontend (single app)

```ts
// apps/plandesk-web/src/lib/capabilities.ts
// The session (owner | member | participant) yields capabilities; the UI reads them for affordances ONLY.
export function useCapabilities(): Capability[] {
  /* from /api/v1/session or portal session */
}

// e.g. a board column shows "+ Add issue" iff caps.includes('submit'); edit handles iff caps.includes('write').
// The server rejects any call the caps don't cover — the client never decides security.
```

Portal mode is the same components mounted under a `/p/:shareToken` route with `write` capability absent and a `submit`-only affordance, hydrating from `GET /view` and subscribing to `GET /events`. No authoring endpoints are reachable with a participant session even though the bundle contains the components — the server returns 401/404.
