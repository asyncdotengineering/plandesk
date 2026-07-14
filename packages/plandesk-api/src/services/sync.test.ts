import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  createProject,
  getPullCursor,
  getSubmission,
  listSubmissions,
  listTasks,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import {
  createSyncDb,
  createSyncServer,
  createSyncToken,
  migrate as migrateSyncServer,
} from '@plandesk/sync-server';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createShareService } from './share.js';
import { createTaskService } from './tasks.js';
import {
  createSyncService,
  InvalidTriageError,
  InvalidTriageInputError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from './sync.js';

const remoteSubmission = {
  id: 'sub-remote-1',
  share_id: 'hosted-share-1',
  participant: { id: 'participant-1', name: 'Alex' },
  title: 'Bug report',
  body: 'Something broke',
  severity: 'high',
  task_ref: null,
  status: 'pending',
  created_at: '2026-01-15T12:00:00.000Z',
};

describe('syncService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM share_submissions');
    await db.$client.execute('DELETE FROM sync_state');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createService() {
    const taskService = createTaskService({ db, eventBus });
    const shareService = createShareService({ db, eventBus });
    return createSyncService({ db, eventBus, taskService, shareService });
  }

  const remote = {
    serverUrl: 'https://sync.example',
    globalProjectId: 'gid-1',
    syncToken: 'plandesk_sync_test',
  };

  it('pull_idempotent: pulling the same submission twice yields one triage row', async () => {
    const project = await createProject(db, { name: 'Pull' });
    const service = createService();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify([remoteSubmission]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    const first = await service.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(first.pulled).toBe(1);
    expect(await listSubmissions(db, project.id)).toHaveLength(1);

    const second = await service.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(second.pulled).toBe(0);
    expect(await listSubmissions(db, project.id)).toHaveLength(1);
  });

  it('advances pull cursor to the max created_at', async () => {
    const project = await createProject(db, { name: 'Cursor' });
    const service = createService();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            remoteSubmission,
            {
              ...remoteSubmission,
              id: 'sub-remote-2',
              created_at: '2026-01-16T12:00:00.000Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await service.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });

    expect(await getPullCursor(db, project.id)).toBe('2026-01-16T12:00:00.000Z');
  });

  it('throws SyncUnauthorizedError on 401 without mutating local state', async () => {
    const project = await createProject(db, { name: 'Auth' });
    const service = createService();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
        ),
    );

    await expect(
      service.pull(project.id, {
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-1',
        syncToken: 'bad-token',
      }),
    ).rejects.toBeInstanceOf(SyncUnauthorizedError);
    expect(await listSubmissions(db, project.id)).toHaveLength(0);
    expect(await getPullCursor(db, project.id)).toBeUndefined();
  });

  it('throws SyncUnavailableError when fetch fails', async () => {
    const project = await createProject(db, { name: 'Down' });
    const service = createService();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      service.pull(project.id, {
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-1',
        syncToken: 'plandesk_sync_test',
      }),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
    expect(await listSubmissions(db, project.id)).toHaveLength(0);
  });

  it('emits submissions_pulled when new rows are materialized', async () => {
    const project = await createProject(db, { name: 'Events' });
    const bus = createEventBus();
    const taskService = createTaskService({ db, eventBus: bus });
    const shareService = createShareService({ db, eventBus: bus });
    const service = createSyncService({ db, eventBus: bus, taskService, shareService });
    const received: PlankDeskEvent[] = [];
    bus.subscribe((event) => {
      received.push(event);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([remoteSubmission]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await service.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });

    expect(received).toContainEqual({ type: 'submissions_pulled', projectId: project.id });
  });

  it('listTriage returns serialized pending submissions', async () => {
    const project = await createProject(db, { name: 'Triage' });
    const service = createService();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([remoteSubmission]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await service.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });

    const triage = await service.listTriage(project.id, 'pending');
    expect(triage).toHaveLength(1);
    expect(triage[0]).toMatchObject({
      id: 'sub-remote-1',
      project_id: project.id,
      participant_name: 'Alex',
      title: 'Bug report',
      status: 'pending',
    });
  });

  async function pullSubmission(projectId: string) {
    const service = createService();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([remoteSubmission]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await service.pull(projectId, remote);
    return service;
  }

  it('triage accept creates task, acks hosted, and sets local accepted', async () => {
    const project = await createProject(db, { name: 'Accept' });
    const service = await pullSubmission(project.id);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.triage('sub-remote-1', 'accept', remote);

    expect(result.status).toBe('accepted');
    expect(result.linked_task_id).toBeTruthy();

    const tasks = await listTasks(db, project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.label).toBe('Bug report');
    // Accept with no as_task (the MCP-style call) must land in `scope`, never `todo` —
    // the human-only scope->todo gate is enforced at this service chokepoint.
    expect(tasks[0]?.status).toBe('scope');
    expect(tasks[0]?.description).toContain('Something broke');
    expect(tasks[0]?.description).toContain('Reported by Alex (client) via Plan Desk');

    const local = await getSubmission(db, 'sub-remote-1');
    expect(local?.status).toBe('accepted');
    expect(local?.linkedTaskId).toBe(result.linked_task_id);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example/api/sync/v1/projects/gid-1/submissions/sub-remote-1/ack',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'accepted' }),
      }),
    );
  });

  it('triage reject sets local rejected and acks hosted', async () => {
    const project = await createProject(db, { name: 'Reject' });
    const service = await pullSubmission(project.id);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.triage('sub-remote-1', 'reject', remote);

    expect(result.status).toBe('rejected');
    expect(result.linked_task_id).toBeNull();
    expect(await listTasks(db, project.id)).toHaveLength(0);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example/api/sync/v1/projects/gid-1/submissions/sub-remote-1/ack',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'rejected' }),
      }),
    );
  });

  it('triage re-accept is idempotent and does not create a duplicate task', async () => {
    const project = await createProject(db, { name: 'Idempotent' });
    const service = await pullSubmission(project.id);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const first = await service.triage('sub-remote-1', 'accept', remote);
    const second = await service.triage('sub-remote-1', 'accept', remote);

    expect(second).toEqual(first);
    expect(await listTasks(db, project.id)).toHaveLength(1);
  });

  it('triage accept keeps task and local accepted when ack fails', async () => {
    const project = await createProject(db, { name: 'Ack fail' });
    const service = await pullSubmission(project.id);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'down' }), { status: 503 })),
    );

    await expect(service.triage('sub-remote-1', 'accept', remote)).rejects.toBeInstanceOf(
      SyncUnavailableError,
    );

    expect(await listTasks(db, project.id)).toHaveLength(1);
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('accepted');
  });

  it('triage retry re-acks after an ack failure (recovers local/remote divergence)', async () => {
    const project = await createProject(db, { name: 'Recover ack' });
    const service = await pullSubmission(project.id);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 503 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    // First attempt commits `accepted` locally, then the ack fails — local/remote diverge.
    await expect(service.triage('sub-remote-1', 'accept', remote)).rejects.toBeInstanceOf(
      SyncUnavailableError,
    );
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('accepted');

    // Retry: the submission is already accepted, so instead of short-circuiting we re-ack
    // the remote (idempotent) — the recovery path. No duplicate task is created.
    const result = await service.triage('sub-remote-1', 'accept', remote);
    expect(result.status).toBe('accepted');
    expect(await listTasks(db, project.id)).toHaveLength(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://sync.example/api/sync/v1/projects/gid-1/submissions/sub-remote-1/ack',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'accepted' }) }),
    );
  });

  it('triage throws InvalidTriageError for unknown submission', async () => {
    const service = createService();
    await expect(service.triage('missing', 'accept', remote)).rejects.toBeInstanceOf(
      InvalidTriageError,
    );
  });

  it('triage accept-as-merge links an existing task without creating a new one', async () => {
    const project = await createProject(db, { name: 'Merge' });
    const existingTask = await createTask(db, { projectId: project.id, label: 'Existing task' });
    const service = await pullSubmission(project.id);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.triage(
      'sub-remote-1',
      'accept',
      remote,
      undefined,
      existingTask.id,
    );

    expect(result.status).toBe('accepted');
    expect(result.linked_task_id).toBe(existingTask.id);

    const tasks = await listTasks(db, project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(existingTask.id);

    const local = await getSubmission(db, 'sub-remote-1');
    expect(local?.status).toBe('accepted');
    expect(local?.linkedTaskId).toBe(existingTask.id);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example/api/sync/v1/projects/gid-1/submissions/sub-remote-1/ack',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'accepted' }),
      }),
    );
  });

  it('triage rejects when both as_task and link_task_id are provided', async () => {
    const project = await createProject(db, { name: 'Mutually exclusive' });
    const existingTask = await createTask(db, { projectId: project.id, label: 'Existing task' });
    const service = await pullSubmission(project.id);

    await expect(
      service.triage('sub-remote-1', 'accept', remote, { label: 'New task' }, existingTask.id),
    ).rejects.toBeInstanceOf(InvalidTriageInputError);

    expect(await listTasks(db, project.id)).toHaveLength(1);
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('pending');
  });

  it('triage rejects link_task_id for a task that does not exist', async () => {
    const project = await createProject(db, { name: 'Missing link target' });
    const service = await pullSubmission(project.id);

    await expect(
      service.triage('sub-remote-1', 'accept', remote, undefined, 'missing-task-id'),
    ).rejects.toBeInstanceOf(InvalidTriageInputError);

    expect(await listTasks(db, project.id)).toHaveLength(0);
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('pending');
  });

  it('triage rejects link_task_id for a task belonging to a different project', async () => {
    const project = await createProject(db, { name: 'Cross-project source' });
    const otherProject = await createProject(db, { name: 'Cross-project other' });
    const otherTask = await createTask(db, { projectId: otherProject.id, label: 'Other project task' });
    const service = await pullSubmission(project.id);

    await expect(
      service.triage('sub-remote-1', 'accept', remote, undefined, otherTask.id),
    ).rejects.toBeInstanceOf(InvalidTriageInputError);

    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('pending');
  });

  it('triage accept-as-merge re-run is idempotent and does not create an orphan task', async () => {
    const project = await createProject(db, { name: 'Merge idempotent' });
    const existingTask = await createTask(db, { projectId: project.id, label: 'Existing task' });
    const service = await pullSubmission(project.id);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const first = await service.triage(
      'sub-remote-1',
      'accept',
      remote,
      undefined,
      existingTask.id,
    );
    const second = await service.triage(
      'sub-remote-1',
      'accept',
      remote,
      undefined,
      existingTask.id,
    );

    expect(second).toEqual(first);
    expect(await listTasks(db, project.id)).toHaveLength(1);
  });
});

async function startTestSyncServer(): Promise<{
  serverUrl: string;
  syncToken: string;
  close: () => void;
}> {
  const syncDb = createSyncDb(':memory:');
  await migrateSyncServer(syncDb);
  const { token: syncToken } = await createSyncToken(syncDb, { label: 'api-test' });
  const app = createSyncServer({ db: syncDb });
  const server: Server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('expected TCP address');
  }

  return {
    serverUrl: `http://127.0.0.1:${String(address.port)}`,
    syncToken,
    close: () => {
      server.close();
    },
  };
}

describe('syncService push', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();
  const servers: Array<{ close: () => void }> = [];
  const remote = {
    serverUrl: 'https://sync.example',
    globalProjectId: 'gid-1',
    syncToken: 'plandesk_sync_test',
  };

  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await migrate(db);
    await db.$client.execute('DELETE FROM share_submissions');
    await db.$client.execute('DELETE FROM sync_state');
    await db.$client.execute('DELETE FROM shares');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
  });

  afterEach(async () => {
    while (servers.length > 0) {
      servers.pop()?.close();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createService() {
    const taskService = createTaskService({ db, eventBus });
    const shareService = createShareService({ db, eventBus });
    return createSyncService({ db, eventBus, taskService, shareService });
  }

  it('publishProject round-trips projection to portal view', async () => {
    const syncServer = await startTestSyncServer();
    servers.push(syncServer);

    const service = createService();
    const shareService = createShareService({ db, eventBus });
    const project = await createProject(db, { name: 'Push Project' });
    await createTask(db, { projectId: project.id, label: 'Visible task' });
    const created = await shareService.createShare(project.id, {
      audienceName: 'Client',
      mode: 'public',
      permissions: { read: true, submit: false },
    });
    if (!created) {
      throw new Error('expected share');
    }

    const { globalProjectId } = await service.publishProject(project.id, {
      serverUrl: syncServer.serverUrl,
      syncToken: syncServer.syncToken,
    });

    const joinRes = await fetch(
      `${syncServer.serverUrl}/api/portal/v1/shares/${created.token}/join`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alex' }),
      },
    );
    expect(joinRes.status).toBe(200);
    const joinBody = (await joinRes.json()) as { session_token: string };

    const viewRes = await fetch(
      `${syncServer.serverUrl}/api/portal/v1/shares/${created.token}/view`,
      { headers: { Authorization: `Bearer ${joinBody.session_token}` } },
    );
    expect(viewRes.status).toBe(200);
    const view = (await viewRes.json()) as {
      project: { name: string };
      tasks: Array<{ label: string }>;
    };
    expect(view.project.name).toBe('Push Project');
    expect(view.tasks.map((task) => task.label)).toContain('Visible task');

    const second = await service.push(project.id, {
      serverUrl: syncServer.serverUrl,
      globalProjectId,
      syncToken: syncServer.syncToken,
    });
    expect(second.pushed).toBe(1);
  });

  it('push skips revoked shares', async () => {
    const syncServer = await startTestSyncServer();
    servers.push(syncServer);

    const service = createService();
    const shareService = createShareService({ db, eventBus });
    const project = await createProject(db, { name: 'Revoked push' });
    const active = await shareService.createShare(project.id, {
      audienceName: 'Active',
      mode: 'public',
    });
    const revoked = await shareService.createShare(project.id, {
      audienceName: 'Revoked',
      mode: 'public',
    });
    if (!active || !revoked) {
      throw new Error('expected shares');
    }
    await shareService.revokeShare(revoked.share.id);

    const { globalProjectId } = await service.publishProject(project.id, {
      serverUrl: syncServer.serverUrl,
      syncToken: syncServer.syncToken,
    });

    const pushed = await service.push(project.id, {
      serverUrl: syncServer.serverUrl,
      globalProjectId,
      syncToken: syncServer.syncToken,
    });
    expect(pushed.pushed).toBe(1);
  });

  it('watchPush coalesces rapid onChange calls into one debounced push', async () => {
    vi.useFakeTimers();
    const project = await createProject(db, { name: 'Watch' });
    const service = createService();
    const pushSpy = vi.spyOn(service, 'push').mockResolvedValue({ pushed: 1 });

    const watcher = service.watchPush(project.id, remote, { debounceMs: 1500 });
    watcher.onChange();
    watcher.onChange();
    watcher.onChange();

    expect(pushSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(project.id, remote);

    watcher.dispose();
    vi.useRealTimers();
  });

  it('watchPush dispose cancels a pending push', async () => {
    vi.useFakeTimers();
    const project = await createProject(db, { name: 'Watch dispose' });
    const service = createService();
    const pushSpy = vi.spyOn(service, 'push').mockResolvedValue({ pushed: 1 });

    const watcher = service.watchPush(project.id, remote, { debounceMs: 1500 });
    watcher.onChange();
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(1500);

    expect(pushSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('watchPush tolerates push errors and schedules the next push', async () => {
    vi.useFakeTimers();
    const project = await createProject(db, { name: 'Watch errors' });
    const service = createService();
    const pushSpy = vi
      .spyOn(service, 'push')
      .mockRejectedValueOnce(new SyncUnavailableError('down'))
      .mockResolvedValueOnce({ pushed: 1 });
    const onPushError = vi.fn();

    const watcher = service.watchPush(project.id, remote, {
      debounceMs: 1500,
      onPushError,
    });
    watcher.onChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(onPushError).toHaveBeenCalledTimes(1);
    expect(onPushError.mock.calls[0]?.[0]).toBeInstanceOf(SyncUnavailableError);

    watcher.onChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(pushSpy).toHaveBeenCalledTimes(2);

    watcher.dispose();
    vi.useRealTimers();
  });

  it('throws SyncUnauthorizedError on bad sync token without mutating local state', async () => {
    const syncServer = await startTestSyncServer();
    servers.push(syncServer);

    const service = createService();
    const shareService = createShareService({ db, eventBus });
    const project = await createProject(db, { name: 'Bad token' });
    await shareService.createShare(project.id, { audienceName: 'Client', mode: 'public' });

    await expect(
      service.push(project.id, {
        serverUrl: syncServer.serverUrl,
        globalProjectId: 'gid-bad',
        syncToken: 'bad-sync-token',
      }),
    ).rejects.toBeInstanceOf(SyncUnauthorizedError);
    expect(await listSubmissions(db, project.id)).toHaveLength(0);
  });
});
