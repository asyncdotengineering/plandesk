import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { deleteProject, getProject, updateProject, clearOverviewDocumentRefs } from './projects.js';
import { createDocument, deleteDocument } from './documents.js';
import { listProjectsInDefaultOrg as listProjects } from '../testing.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';

describe('projects repository', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('creates and retrieves a project', async () => {
    const created = await createProject(db, {
      name: 'Checkout Revamp',
      description: 'Q2 initiative',
    });
    const fetched = await getProject(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.name).toBe('Checkout Revamp');
  });

  it('round-trips workspace_id', async () => {
    const created = await createProject(db, {
      name: 'Workspace Scoped',
      workspaceId: 'team-123',
    });
    const fetched = await getProject(db, created.id);
    expect(fetched?.workspaceId).toBe('team-123');
  });

  it('returns undefined for a missing project', async () => {
    expect(await getProject(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists all projects', async () => {
    await createProject(db, { name: 'Alpha' });
    await createProject(db, { name: 'Beta' });
    const all = await listProjects(db);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('updates a project and bumps updated_at', async () => {
    const created = await createProject(db, { name: 'Before' });
    const updated = await updateProject(db, created.id, { name: 'After' });
    expect(updated?.name).toBe('After');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('returns undefined when updating a missing project', async () => {
    expect(
      await updateProject(db, '00000000-0000-4000-8000-000000009999', { name: 'Ghost' }),
    ).toBeUndefined();
  });

  it('paginates project list', async () => {
    await createProject(db, { name: 'A' });
    await createProject(db, { name: 'B' });
    await createProject(db, { name: 'C' });
    expect(await listProjects(db, { limit: 1, offset: 1 })).toHaveLength(1);
  });

  it('deletes a project', async () => {
    const created = await createProject(db, { name: 'Delete me' });
    expect(await deleteProject(db, created.id)).toBe(true);
    expect(await getProject(db, created.id)).toBeUndefined();
    expect(await deleteProject(db, created.id)).toBe(false);
  });

  it('stores repo_url and folder_path, defaulting to null', async () => {
    const bare = await createProject(db, { name: 'Bare' });
    expect(bare.repoUrl).toBeNull();
    expect(bare.folderPath).toBeNull();

    const bound = await createProject(db, {
      name: 'Bound',
      repoUrl: 'https://github.com/acme/plandesk',
      folderPath: 'packages/plandesk-api',
    });
    const fetched = await getProject(db, bound.id);
    expect(fetched?.repoUrl).toBe('https://github.com/acme/plandesk');
    expect(fetched?.folderPath).toBe('packages/plandesk-api');
  });

  it('allows two projects to share one repo_url with different folder_path values', async () => {
    const repoUrl = 'https://github.com/acme/monorepo';
    const api = await createProject(db, {
      name: 'API',
      repoUrl,
      folderPath: 'packages/plandesk-api',
    });
    const dbPkg = await createProject(db, {
      name: 'DB',
      repoUrl,
      folderPath: 'packages/plandesk-db',
    });
    expect(api.repoUrl).toBe(repoUrl);
    expect(dbPkg.repoUrl).toBe(repoUrl);
    expect(api.folderPath).not.toBe(dbPkg.folderPath);
    expect(await getProject(db, api.id)).toMatchObject({
      repoUrl,
      folderPath: 'packages/plandesk-api',
    });
    expect(await getProject(db, dbPkg.id)).toMatchObject({
      repoUrl,
      folderPath: 'packages/plandesk-db',
    });
  });

  it('clears repo_url and folder_path on update with null', async () => {
    const created = await createProject(db, {
      name: 'Clearable',
      repoUrl: 'https://github.com/acme/plandesk',
      folderPath: 'apps/web',
    });
    const updated = await updateProject(db, created.id, {
      repoUrl: null,
      folderPath: null,
    });
    expect(updated?.repoUrl).toBeNull();
    expect(updated?.folderPath).toBeNull();
  });

  it('owner and overview default null; set, clear with null, omit leaves unchanged', async () => {
    const created = await createProject(db, { name: 'Meta' });
    expect(created.ownerId).toBeNull();
    expect(created.overviewDocumentId).toBeNull();

    const doc = await createDocument(db, { projectId: created.id, title: 'Spec' });

    const set = await updateProject(db, created.id, {
      ownerId: 'user-ada',
      overviewDocumentId: doc.id,
    });
    expect(set?.ownerId).toBe('user-ada');
    expect(set?.overviewDocumentId).toBe(doc.id);

    const cleared = await updateProject(db, created.id, {
      ownerId: null,
      overviewDocumentId: null,
    });
    expect(cleared?.ownerId).toBeNull();
    expect(cleared?.overviewDocumentId).toBeNull();

    await updateProject(db, created.id, {
      ownerId: 'user-bob',
      overviewDocumentId: doc.id,
    });
    const omitted = await updateProject(db, created.id, { name: 'Still Meta' });
    expect(omitted?.name).toBe('Still Meta');
    expect(omitted?.ownerId).toBe('user-bob');
    expect(omitted?.overviewDocumentId).toBe(doc.id);

    await clearOverviewDocumentRefs(db, doc.id);
    expect((await getProject(db, created.id))?.overviewDocumentId).toBeNull();
    expect(await deleteDocument(db, doc.id)).toBe(true);
  });
});
