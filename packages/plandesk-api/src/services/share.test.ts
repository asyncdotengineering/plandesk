import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, createProject, getShare, listShares, migrate } from '@plandesk/db';
import { createEventBus } from '../events.js';
import { createProjectService } from './projects.js';
import { createShareService, InvalidShareError, serializeShare } from './share.js';
import { createSyncService } from './sync.js';
import { createTaskService } from './tasks.js';

describe('shareService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM share_submissions');
    db.$client.exec('DELETE FROM sync_state');
    db.$client.exec('DELETE FROM shares');
    db.$client.exec('DELETE FROM projects');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createService() {
    return createShareService({ db, eventBus });
  }

  it('creates a share and returns the raw token once', () => {
    const service = createService();
    const project = createProject(db, { name: 'Share me' });

    const result = service.createShare(project.id, {
      audienceName: 'Acme',
      mode: 'invite',
    });

    expect(result?.token).toMatch(/^plandesk_share_/);
    expect(result?.share).toMatchObject({
      project_id: project.id,
      audience_name: 'Acme',
      mode: 'invite',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(result?.share).not.toHaveProperty('token_hash');
    expect(JSON.stringify(result?.share)).not.toContain(result?.token ?? '');
  });

  it('lists shares for a project', () => {
    const service = createService();
    const project = createProject(db, { name: 'List shares' });
    service.createShare(project.id, { audienceName: 'A', mode: 'public' });
    service.createShare(project.id, { audienceName: 'B', mode: 'invite' });

    const shares = service.listShares(project.id);
    expect(shares).toHaveLength(2);
    expect(shares?.map((s) => s.audience_name).sort()).toEqual(['A', 'B']);
  });

  it('returns undefined for missing projects', () => {
    const service = createService();
    expect(
      service.createShare('00000000-0000-4000-8000-000000009999', {
        audienceName: 'Ghost',
        mode: 'invite',
      }),
    ).toBeUndefined();
    expect(service.listShares('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('throws InvalidShareError for empty audience names', () => {
    const service = createService();
    const project = createProject(db, { name: 'Invalid' });
    expect(() => service.createShare(project.id, { audienceName: '   ', mode: 'invite' })).toThrow(
      InvalidShareError,
    );
  });

  it('revokes a share', () => {
    const service = createService();
    const project = createProject(db, { name: 'Revoke' });
    const created = service.createShare(project.id, {
      audienceName: 'Revoke',
      mode: 'invite',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }
    expect(service.revokeShare(created.share.id)).toBe(true);
    expect(getShare(db, created.share.id)?.revokedAt).toBeTruthy();
    expect(service.revokeShare(created.share.id)).toBe(false);
  });

  it('buildClientView loads the share projection', () => {
    const service = createService();
    const project = createProject(db, { name: 'View' });
    const created = service.createShare(project.id, {
      audienceName: 'Viewers',
      mode: 'public',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }

    const view = service.buildClientView(project.id, created.share.id);
    expect(view?.project.name).toBe('View');
    expect(view?.share.audience_name).toBe('Viewers');
  });

  it('serializeShare never includes token_hash', () => {
    const project = createProject(db, { name: 'Serialize' });
    const service = createService();
    const created = service.createShare(project.id, {
      audienceName: 'Serialize',
      mode: 'invite',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }
    const row = getShare(db, created.share.id);
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    const serialized = serializeShare(row);
    expect(serialized).not.toHaveProperty('token_hash');
    expect(JSON.stringify(serialized)).not.toContain(created.token);
  });

  it('cascade deletes shares when a project is deleted', () => {
    const projectService = createProjectService({ db, eventBus });
    const shareService = createService();
    const project = createProject(db, { name: 'Cascade shares' });
    shareService.createShare(project.id, { audienceName: 'Gone', mode: 'invite' });

    expect(listShares(db, project.id)).toHaveLength(1);
    expect(projectService.delete(project.id)).toBe(true);
    expect(listShares(db, project.id)).toHaveLength(0);
  });

  it('cascade deletes pulled submissions when a project is deleted', async () => {
    const projectService = createProjectService({ db, eventBus });
    const project = createProject(db, { name: 'Cascade submissions' });
    const taskService = createTaskService({ db, eventBus });
    const shareServiceForSync = createShareService({ db, eventBus });
    const syncService = createSyncService({
      db,
      eventBus,
      taskService,
      shareService: shareServiceForSync,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 'sub-cascade',
              share_id: 'hosted-share-1',
              participant: { id: 'p1', name: 'Alex' },
              title: 'Gone',
              body: null,
              severity: null,
              task_ref: null,
              status: 'pending',
              created_at: '2026-01-15T12:00:00.000Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await syncService.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(syncService.listTriage(project.id)).toHaveLength(1);

    expect(projectService.delete(project.id)).toBe(true);
    expect(syncService.listTriage(project.id)).toHaveLength(0);
  });
});
