import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import {
  createShare,
  deleteSharesByProjectId,
  getShare,
  getShareByTokenHash,
  hashShareToken,
  listShares,
  revokeShare,
} from './shares.js';
import { createProject } from './projects.js';

describe('shares repository', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM shares');
    db.$client.exec('DELETE FROM projects');
  });

  it('creates a share with plandesk_share_ prefix and stores sha256 only', () => {
    const project = createProject(db, { name: 'Shared' });
    const { share, token } = createShare(db, {
      projectId: project.id,
      audienceName: 'Acme Corp',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });

    expect(share.audienceName).toBe('Acme Corp');
    expect(token).toMatch(/^plandesk_share_/);
    expect(share.id).toBeTruthy();

    const row = db.$client.prepare('SELECT token_hash FROM shares WHERE id = ?').get(share.id) as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64);
    expect(row.token_hash).toBe(hashShareToken(token));
  });

  it('gets a share by id', () => {
    const project = createProject(db, { name: 'Get' });
    const { share } = createShare(db, {
      projectId: project.id,
      audienceName: 'Viewer',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(getShare(db, share.id)?.id).toBe(share.id);
  });

  it('lists shares for a project', () => {
    const project = createProject(db, { name: 'List' });
    createShare(db, {
      projectId: project.id,
      audienceName: 'A',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    createShare(db, {
      projectId: project.id,
      audienceName: 'B',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(listShares(db, project.id)).toHaveLength(2);
  });

  it('looks up a share by token hash when active', () => {
    const project = createProject(db, { name: 'Token' });
    const { share, token } = createShare(db, {
      projectId: project.id,
      audienceName: 'Token lookup',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(getShareByTokenHash(db, hashShareToken(token))?.id).toBe(share.id);
  });

  it('rejects revoked shares by token hash', () => {
    const project = createProject(db, { name: 'Revoked' });
    const { share, token } = createShare(db, {
      projectId: project.id,
      audienceName: 'Revoked',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    revokeShare(db, share.id);
    expect(getShareByTokenHash(db, hashShareToken(token))).toBeUndefined();
  });

  it('rejects expired shares by token hash', () => {
    const project = createProject(db, { name: 'Expired' });
    const past = new Date(Date.now() - 60_000);
    const { token } = createShare(db, {
      projectId: project.id,
      audienceName: 'Expired',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
      expiresAt: past,
    });
    expect(getShareByTokenHash(db, hashShareToken(token))).toBeUndefined();
  });

  it('revokes a share once', () => {
    const project = createProject(db, { name: 'Once' });
    const { share } = createShare(db, {
      projectId: project.id,
      audienceName: 'Once',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(revokeShare(db, share.id)?.revokedAt).toBeTruthy();
    expect(revokeShare(db, share.id)).toBeUndefined();
  });

  it('deletes shares by project id', () => {
    const project = createProject(db, { name: 'Delete' });
    createShare(db, {
      projectId: project.id,
      audienceName: 'Delete me',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(deleteSharesByProjectId(db, project.id)).toBe(1);
    expect(listShares(db, project.id)).toHaveLength(0);
  });
});
