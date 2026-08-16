import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { createArtifactService, InvalidArtifactError } from './artifacts.js';
import { createPrototypeService } from './prototypes.js';

describe('artifactService prototype_id', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Artifacts' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function artifacts() {
    return createArtifactService({ db, orgId });
  }

  function prototypes() {
    return createPrototypeService({ db, orgId });
  }

  it('create_artifact with no prototype_id behaves exactly as today for markdown', async () => {
    const artifact = await artifacts().create(projectId, {
      title: 'Report',
      kind: 'markdown',
      content: '# Report body',
    });
    expect(artifact).toMatchObject({
      title: 'Report',
      kind: 'markdown',
      content: '# Report body',
      prototype_id: null,
      x: null,
      y: null,
    });
  });

  it('serializes a prototype-less markdown report with null prototype_id, x, y', async () => {
    const created = await artifacts().create(projectId, {
      title: 'Weekly report',
      kind: 'markdown',
      content: '# Status',
    });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }
    const fetched = await artifacts().get(created.id);
    expect(fetched).toEqual(
      expect.objectContaining({
        id: created.id,
        kind: 'markdown',
        prototype_id: null,
        x: null,
        y: null,
      }),
    );
    // Additive shape: keys are always present (null for reports), not omitted.
    expect(Object.prototype.hasOwnProperty.call(fetched, 'prototype_id')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(fetched, 'x')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(fetched, 'y')).toBe(true);
  });

  it('refuses create_artifact with prototype_id and kind markdown', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }
    await expect(
      artifacts().create(projectId, {
        title: 'Screen',
        kind: 'markdown',
        content: '# no',
        prototypeId: proto.id,
      }),
    ).rejects.toThrow(InvalidArtifactError);
  });

  it('attaches a same-project html screen to a prototype', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }
    const screen = await artifacts().create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<html></html>',
      prototypeId: proto.id,
    });
    expect(screen?.prototype_id).toBe(proto.id);
    expect(screen?.kind).toBe('html');
  });

  it('refuses a prototype_id belonging to another project', async () => {
    const other = await createProject(db, { name: 'Other' });
    const foreign = await createPrototypeService({ db, orgId: other.orgId }).create(other.id, {
      name: 'Foreign',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(foreign).toBeDefined();
    if (!foreign) {
      return;
    }

    await expect(
      artifacts().create(projectId, {
        title: 'Leak attempt',
        kind: 'html',
        content: '<html></html>',
        prototypeId: foreign.id,
      }),
    ).rejects.toThrow(/cross-project|does not belong/i);
  });

  it('refuses updating an artifact to a foreign prototype_id', async () => {
    const local = await prototypes().create(projectId, {
      name: 'Local',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(local).toBeDefined();
    if (!local) {
      return;
    }
    const screen = await artifacts().create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<html></html>',
      prototypeId: local.id,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }

    const other = await createProject(db, { name: 'Other' });
    const foreign = await createPrototypeService({ db, orgId: other.orgId }).create(other.id, {
      name: 'Foreign',
      viewportWidth: 1024,
      viewportHeight: 768,
    });
    expect(foreign).toBeDefined();
    if (!foreign) {
      return;
    }

    await expect(artifacts().update(screen.id, { prototypeId: foreign.id })).rejects.toThrow(
      /cross-project|does not belong/i,
    );
  });

  it('refuses changing kind to markdown while prototype_id remains set', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }
    const screen = await artifacts().create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<html></html>',
      prototypeId: proto.id,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }
    await expect(artifacts().update(screen.id, { kind: 'markdown' })).rejects.toThrow(
      InvalidArtifactError,
    );
  });
});
