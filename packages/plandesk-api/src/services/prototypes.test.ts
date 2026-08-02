import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  getPrototype,
  migrate,
  type Db,
} from '@plandesk/db';
import { createArtifactService } from './artifacts.js';
import { createPrototypeService, InvalidPrototypeError } from './prototypes.js';

describe('prototypeService', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Prototypes' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function service() {
    return createPrototypeService({ db, orgId });
  }

  it('create → list → get round-trips with screens', async () => {
    const created = await service().create(projectId, {
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(created?.name).toBe('Checkout');
    expect(created?.viewport_width).toBe(390);
    expect(created?.viewport_height).toBe(844);
    if (!created) {
      throw new Error('missing prototype');
    }
    expect(await getPrototype(db, created.id)).toBeDefined();

    const listed = await service().list(projectId);
    expect(listed).toHaveLength(1);
    expect(listed?.[0]?.id).toBe(created.id);

    await createArtifactService({ db, orgId }).create(projectId, {
      title: 'Cart',
      kind: 'html',
      content: '<html></html>',
      prototypeId: created.id,
    });

    const got = await service().get(created.id);
    expect(got?.screens).toHaveLength(1);
    expect(got?.screens[0]?.title).toBe('Cart');
    expect(got?.screens[0]?.prototype_id).toBe(created.id);
    expect(got?.links).toEqual([]);
  });

  it('updates name and viewport', async () => {
    const created = await service().create(projectId, {
      name: 'Before',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }
    const updated = await service().update(created.id, {
      name: 'After',
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(updated?.name).toBe('After');
    expect(updated?.viewport_width).toBe(1440);
  });

  it('throws on blank name or non-positive viewport', async () => {
    await expect(
      service().create(projectId, { name: '  ', viewportWidth: 390, viewportHeight: 844 }),
    ).rejects.toThrow(InvalidPrototypeError);
    await expect(
      service().create(projectId, { name: 'Bad', viewportWidth: 0, viewportHeight: 844 }),
    ).rejects.toThrow(InvalidPrototypeError);
  });

  it('returns undefined for a foreign-org project', async () => {
    expect(
      await service().create('00000000-0000-4000-8000-000000009999', {
        name: 'Orphan',
        viewportWidth: 390,
        viewportHeight: 844,
      }),
    ).toBeUndefined();
  });
});
