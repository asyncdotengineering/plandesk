import { describe, expect, it, beforeEach } from 'vitest';
import { createDb, createProject, migrate } from '../index.js';
import { deleteSyncRemoteByProjectId, getSyncRemote, setSyncRemote } from './sync-remotes.js';

describe('sync-remotes repository', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM sync_remotes');
    db.$client.exec('DELETE FROM projects');
  });

  it('setSyncRemote upserts by project_id', () => {
    const project = createProject(db, { name: 'Remote' });

    const created = setSyncRemote(db, project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(created.serverUrl).toBe('https://sync.example');
    expect(created.globalProjectId).toBe('gid-1');
    expect(created.syncToken).toBe('plandesk_sync_test');

    const updated = setSyncRemote(db, project.id, {
      serverUrl: 'https://sync2.example',
      globalProjectId: 'gid-2',
      syncToken: 'plandesk_sync_new',
    });
    expect(updated.serverUrl).toBe('https://sync2.example');
    expect(updated.globalProjectId).toBe('gid-2');
    expect(getSyncRemote(db, project.id)?.syncToken).toBe('plandesk_sync_new');
  });

  it('deleteSyncRemoteByProjectId removes the row', () => {
    const project = createProject(db, { name: 'Delete remote' });
    setSyncRemote(db, project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });

    expect(deleteSyncRemoteByProjectId(db, project.id)).toBe(1);
    expect(getSyncRemote(db, project.id)).toBeUndefined();
  });
});
