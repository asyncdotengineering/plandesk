import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrate, type Db } from '../index.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import {
  createPrototype,
  deletePrototypesByProjectId,
  getPrototype,
  getPrototypeByProjectAndId,
  listPrototypes,
  updatePrototype,
} from './prototypes.js';

describe('prototypes repository', () => {
  let db: Db;
  let projectId: string;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Proto Project' })).id;
  });

  it('creates and fetches a prototype with viewport', async () => {
    const created = await createPrototype(db, {
      projectId,
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(created.name).toBe('Checkout');
    expect(created.viewportWidth).toBe(390);
    expect(created.viewportHeight).toBe(844);

    const fetched = await getPrototype(db, created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.projectId).toBe(projectId);
  });

  it('lists prototypes for a project only', async () => {
    await createPrototype(db, {
      projectId,
      name: 'One',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    await createPrototype(db, {
      projectId,
      name: 'Two',
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const other = (await createProject(db, { name: 'Other' })).id;
    await createPrototype(db, {
      projectId: other,
      name: 'Elsewhere',
      viewportWidth: 1024,
      viewportHeight: 768,
    });
    expect(await listPrototypes(db, projectId)).toHaveLength(2);
  });

  it('scopes getPrototypeByProjectAndId to the project', async () => {
    const proto = await createPrototype(db, {
      projectId,
      name: 'Scoped',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const other = (await createProject(db, { name: 'Other' })).id;
    expect(await getPrototypeByProjectAndId(db, projectId, proto.id)).toBeDefined();
    expect(await getPrototypeByProjectAndId(db, other, proto.id)).toBeUndefined();
  });

  it('updates name and viewport', async () => {
    const created = await createPrototype(db, {
      projectId,
      name: 'Before',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const updated = await updatePrototype(db, created.id, {
      name: 'After',
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(updated?.name).toBe('After');
    expect(updated?.viewportWidth).toBe(1440);
    expect(updated?.viewportHeight).toBe(900);
  });

  it('deletePrototypesByProjectId removes every prototype for the project', async () => {
    await createPrototype(db, {
      projectId,
      name: 'One',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    await createPrototype(db, {
      projectId,
      name: 'Two',
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const other = (await createProject(db, { name: 'Other' })).id;
    const kept = await createPrototype(db, {
      projectId: other,
      name: 'Elsewhere',
      viewportWidth: 1024,
      viewportHeight: 768,
    });

    expect(await deletePrototypesByProjectId(db, projectId)).toBe(2);
    expect(await listPrototypes(db, projectId)).toHaveLength(0);
    expect(await getPrototype(db, kept.id)).toBeDefined();
  });
});
