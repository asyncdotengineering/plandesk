import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createProjectInDefaultOrg as createProject, migrate, type Db } from '@plandesk/db';
import { createServices } from '@plandesk/api';
import { createCreatePrototypeHandler } from './create-prototype.js';
import { createGetPrototypeHandler } from './get-prototype.js';
import { createListPrototypesHandler } from './list-prototypes.js';
import { createUpdatePrototypeHandler } from './update-prototype.js';
import { createCreateArtifactHandler } from './create-artifact.js';
import { createGetArtifactHandler } from './get-artifact.js';

describe('prototype MCP tools', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'MCP Protos' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('create → list → get with screens → update', async () => {
    const services = createServices({ db, orgId });
    const create = createCreatePrototypeHandler(services.prototypeService);
    const list = createListPrototypesHandler(services.prototypeService);
    const get = createGetPrototypeHandler(services.prototypeService);
    const update = createUpdatePrototypeHandler(services.prototypeService);
    const createArtifact = createCreateArtifactHandler(services.artifactService);

    const created = await create({
      project_id: projectId,
      name: 'Checkout',
      viewport_width: 390,
      viewport_height: 844,
    });
    expect(created.isError).toBeFalsy();
    const createdText = JSON.parse(
      (created.content[0] as { text: string }).text,
    ) as { prototype: { id: string; name: string } };
    const prototypeId = createdText.prototype.id;

    const listed = await list({ project_id: projectId });
    expect(listed.isError).toBeFalsy();

    await createArtifact({
      project_id: projectId,
      title: 'Home',
      content: '<html></html>',
      kind: 'html',
      prototype_id: prototypeId,
    });

    const got = await get({ prototype_id: prototypeId });
    expect(got.isError).toBeFalsy();
    const gotBody = JSON.parse((got.content[0] as { text: string }).text) as {
      prototype: { screens: Array<{ title: string }> };
    };
    expect(gotBody.prototype.screens).toHaveLength(1);
    expect(gotBody.prototype.screens[0]?.title).toBe('Home');

    const updated = await update({
      prototype_id: prototypeId,
      name: 'Checkout v2',
      viewport_width: 1440,
      viewport_height: 900,
    });
    expect(updated.isError).toBeFalsy();
  });

  it('refuses markdown screen and cross-project prototype_id', async () => {
    const services = createServices({ db, orgId });
    const create = createCreatePrototypeHandler(services.prototypeService);
    const createArtifact = createCreateArtifactHandler(services.artifactService);

    const created = await create({
      project_id: projectId,
      name: 'Flow',
      viewport_width: 390,
      viewport_height: 844,
    });
    const prototypeId = (
      JSON.parse((created.content[0] as { text: string }).text) as {
        prototype: { id: string };
      }
    ).prototype.id;

    const markdown = await createArtifact({
      project_id: projectId,
      title: 'Nope',
      content: '# x',
      kind: 'markdown',
      prototype_id: prototypeId,
    });
    expect(markdown.isError).toBe(true);

    const other = await createProject(db, { name: 'Other' });
    const foreignServices = createServices({ db, orgId: other.orgId });
    const foreign = await createCreatePrototypeHandler(foreignServices.prototypeService)({
      project_id: other.id,
      name: 'Foreign',
      viewport_width: 390,
      viewport_height: 844,
    });
    const foreignId = (
      JSON.parse((foreign.content[0] as { text: string }).text) as {
        prototype: { id: string };
      }
    ).prototype.id;

    const cross = await createArtifact({
      project_id: projectId,
      title: 'Leak',
      content: '<html></html>',
      kind: 'html',
      prototype_id: foreignId,
    });
    expect(cross.isError).toBe(true);
  });

  it('get_artifact serializes a prototype-less markdown report with null prototype_id, x, y', async () => {
    const services = createServices({ db, orgId });
    const createArtifact = createCreateArtifactHandler(services.artifactService);
    const getArtifact = createGetArtifactHandler(services.artifactService);

    const created = await createArtifact({
      project_id: projectId,
      title: 'Design RFC',
      content: '# Architecture',
      kind: 'markdown',
    });
    expect(created.isError).toBeFalsy();
    const createdBody = JSON.parse((created.content[0] as { text: string }).text) as {
      artifact: { artifact_id: string };
    };

    const got = await getArtifact({ artifact_id: createdBody.artifact.artifact_id });
    expect(got.isError).toBeFalsy();
    const gotBody = JSON.parse((got.content[0] as { text: string }).text) as {
      artifact: {
        kind: string;
        prototype_id: string | null;
        x: number | null;
        y: number | null;
      };
    };
    expect(gotBody.artifact).toEqual(
      expect.objectContaining({
        kind: 'markdown',
        prototype_id: null,
        x: null,
        y: null,
      }),
    );
    expect(Object.prototype.hasOwnProperty.call(gotBody.artifact, 'prototype_id')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(gotBody.artifact, 'x')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(gotBody.artifact, 'y')).toBe(true);
  });
});
