import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, createProject, getPullCursor, listSubmissions, migrate } from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createSyncService, SyncUnauthorizedError, SyncUnavailableError } from './sync.js';

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
    db.$client.exec('DELETE FROM projects');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createService() {
    return createSyncService({ db, eventBus });
  }

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
    const service = createSyncService({ db, eventBus: bus });
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
});
