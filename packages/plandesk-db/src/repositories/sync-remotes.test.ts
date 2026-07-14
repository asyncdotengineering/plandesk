import { describe, expect, it, beforeEach } from 'vitest';
import { createDb, createProjectInDefaultOrg as createProject, migrate, type Db } from '../index.js';
import { deleteSyncRemoteByProjectId, getSyncRemote, setSyncRemote } from './sync-remotes.js';

describe('sync-remotes repository', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('setSyncRemote upserts by project_id', async () => {
    const project = await createProject(db, { name: 'Remote' });

    const created = await setSyncRemote(db, project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(created.serverUrl).toBe('https://sync.example');
    expect(created.globalProjectId).toBe('gid-1');
    expect(created.syncToken).toBe('plandesk_sync_test');

    const updated = await setSyncRemote(db, project.id, {
      serverUrl: 'https://sync2.example',
      globalProjectId: 'gid-2',
      syncToken: 'plandesk_sync_new',
    });
    expect(updated.serverUrl).toBe('https://sync2.example');
    expect(updated.globalProjectId).toBe('gid-2');
    expect((await getSyncRemote(db, project.id))?.syncToken).toBe('plandesk_sync_new');
  });

  it('deleteSyncRemoteByProjectId removes the row', async () => {
    const project = await createProject(db, { name: 'Delete remote' });
    await setSyncRemote(db, project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });

    expect(await deleteSyncRemoteByProjectId(db, project.id)).toBe(1);
    expect(await getSyncRemote(db, project.id)).toBeUndefined();
  });
});
