import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
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
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('creates a share with plandesk_share_ prefix and stores sha256 only', async () => {
    const project = await createProject(db, { name: 'Shared' });
    const { share, token } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Acme Corp',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });

    expect(share.audienceName).toBe('Acme Corp');
    expect(token).toMatch(/^plandesk_share_/);
    expect(share.id).toBeTruthy();

    const row = (
      await db.$client.execute({
        sql: 'SELECT token_hash FROM shares WHERE id = ?',
        args: [share.id],
      })
    ).rows[0];
    expect(row).toBeDefined();
    expect(row?.token_hash).not.toBe(token);
    expect(String(row?.token_hash)).toHaveLength(64);
    expect(row?.token_hash).toBe(hashShareToken(token));
  });

  it('gets a share by id', async () => {
    const project = await createProject(db, { name: 'Get' });
    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Viewer',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect((await getShare(db, share.id))?.id).toBe(share.id);
  });

  it('lists shares for a project', async () => {
    const project = await createProject(db, { name: 'List' });
    await createShare(db, {
      projectId: project.id,
      audienceName: 'A',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    await createShare(db, {
      projectId: project.id,
      audienceName: 'B',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(await listShares(db, project.id)).toHaveLength(2);
  });

  it('looks up a share by token hash when active', async () => {
    const project = await createProject(db, { name: 'Token' });
    const { share, token } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Token lookup',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect((await getShareByTokenHash(db, hashShareToken(token)))?.id).toBe(share.id);
  });

  it('rejects revoked shares by token hash', async () => {
    const project = await createProject(db, { name: 'Revoked' });
    const { share, token } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Revoked',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    await revokeShare(db, share.id);
    expect(await getShareByTokenHash(db, hashShareToken(token))).toBeUndefined();
  });

  it('rejects expired shares by token hash', async () => {
    const project = await createProject(db, { name: 'Expired' });
    const past = new Date(Date.now() - 60_000);
    const { token } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Expired',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
      expiresAt: past,
    });
    expect(await getShareByTokenHash(db, hashShareToken(token))).toBeUndefined();
  });

  it('revokes a share once', async () => {
    const project = await createProject(db, { name: 'Once' });
    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Once',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect((await revokeShare(db, share.id))?.revokedAt).toBeTruthy();
    expect(await revokeShare(db, share.id)).toBeUndefined();
  });

  it('deletes shares by project id', async () => {
    const project = await createProject(db, { name: 'Delete' });
    await createShare(db, {
      projectId: project.id,
      audienceName: 'Delete me',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(await deleteSharesByProjectId(db, project.id)).toBe(1);
    expect(await listShares(db, project.id)).toHaveLength(0);
  });
});
