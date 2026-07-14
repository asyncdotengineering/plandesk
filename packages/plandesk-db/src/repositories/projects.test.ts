import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import {
  deleteProject,
  getProject,
  updateProject,
} from './projects.js';
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
});
