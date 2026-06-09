import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  createProject,
  getPullCursor,
  getSubmission,
  listSubmissions,
  listTasks,
  migrate,
} from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createTaskService } from './tasks.js';
import {
  createSyncService,
  InvalidTriageError,
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
  const db = createDb(':memory:');
  const eventBus = createEventBus();

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM share_submissions');
    db.$client.exec('DELETE FROM sync_state');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createService() {
    const taskService = createTaskService({ db, eventBus });
    return createSyncService({ db, eventBus, taskService });
  }

  const remote = {
    serverUrl: 'https://sync.example',
    globalProjectId: 'gid-1',
    syncToken: 'plandesk_sync_test',
  };

  it('pull_idempotent: pulling the same submission twice yields one triage row', async () => {
    const project = createProject(db, { name: 'Pull' });
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
    expect(listSubmissions(db, project.id)).toHaveLength(1);

    const second = await service.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(second.pulled).toBe(0);
    expect(listSubmissions(db, project.id)).toHaveLength(1);
  });

  it('advances pull cursor to the max created_at', async () => {
    const project = createProject(db, { name: 'Cursor' });
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

    expect(getPullCursor(db, project.id)).toBe('2026-01-16T12:00:00.000Z');
  });

  it('throws SyncUnauthorizedError on 401 without mutating local state', async () => {
    const project = createProject(db, { name: 'Auth' });
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
    expect(listSubmissions(db, project.id)).toHaveLength(0);
    expect(getPullCursor(db, project.id)).toBeUndefined();
  });

  it('throws SyncUnavailableError when fetch fails', async () => {
    const project = createProject(db, { name: 'Down' });
    const service = createService();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      service.pull(project.id, {
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-1',
        syncToken: 'plandesk_sync_test',
      }),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
    expect(listSubmissions(db, project.id)).toHaveLength(0);
  });

  it('emits submissions_pulled when new rows are materialized', async () => {
    const project = createProject(db, { name: 'Events' });
    const bus = createEventBus();
    const taskService = createTaskService({ db, eventBus: bus });
    const service = createSyncService({ db, eventBus: bus, taskService });
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
    const project = createProject(db, { name: 'Triage' });
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

    const triage = service.listTriage(project.id, 'pending');
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
    const project = createProject(db, { name: 'Accept' });
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

    const tasks = listTasks(db, project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.label).toBe('Bug report');
    expect(tasks[0]?.description).toContain('Something broke');
    expect(tasks[0]?.description).toContain('Reported by Alex (client) via Plan Desk');

    const local = getSubmission(db, 'sub-remote-1');
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
    const project = createProject(db, { name: 'Reject' });
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
    expect(listTasks(db, project.id)).toHaveLength(0);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example/api/sync/v1/projects/gid-1/submissions/sub-remote-1/ack',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'rejected' }),
      }),
    );
  });

  it('triage re-accept is idempotent and does not create a duplicate task', async () => {
    const project = createProject(db, { name: 'Idempotent' });
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
    expect(listTasks(db, project.id)).toHaveLength(1);
  });

  it('triage accept keeps task and local accepted when ack fails', async () => {
    const project = createProject(db, { name: 'Ack fail' });
    const service = await pullSubmission(project.id);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'down' }), { status: 503 })),
    );

    await expect(service.triage('sub-remote-1', 'accept', remote)).rejects.toBeInstanceOf(
      SyncUnavailableError,
    );

    expect(listTasks(db, project.id)).toHaveLength(1);
    expect(getSubmission(db, 'sub-remote-1')?.status).toBe('accepted');
  });

  it('triage throws InvalidTriageError for unknown submission', async () => {
    const service = createService();
    await expect(service.triage('missing', 'accept', remote)).rejects.toBeInstanceOf(
      InvalidTriageError,
    );
  });
});
