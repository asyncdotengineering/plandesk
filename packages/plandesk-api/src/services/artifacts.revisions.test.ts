import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  listPrototypeLinksByFromArtifact,
  listRevisionsByTarget,
  migrate,
  type Db,
} from '@plandesk/db';
import { createArtifactService } from './artifacts.js';
import { createDocumentService } from './documents.js';
import { createPrototypeService } from './prototypes.js';
import { createRevisionService } from './revisions.js';
import { createTaskService } from './tasks.js';

describe('artifact revisions', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Artifact revisions' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function services(maxRevisions: number | null = null) {
    const taskService = createTaskService({ db, orgId, maxRevisions });
    const documentService = createDocumentService({ db, orgId, maxRevisions, taskService });
    const artifactService = createArtifactService({ db, orgId, maxRevisions });
    const revisionService = createRevisionService({
      db,
      orgId,
      taskService,
      documentService,
      artifactService,
    });
    return { artifactService, revisionService, documentService, taskService };
  }

  it('three successive content writes produce three revisions, diffable and restorable', async () => {
    const { artifactService, revisionService } = services();
    const created = await artifactService.create(projectId, {
      title: 'Screen',
      kind: 'html',
      content: '<p>v0</p>',
    });
    expect(created).toBeDefined();
    if (!created) return;

    await artifactService.update(created.id, { content: '<p>v1</p>' });
    await artifactService.update(created.id, { content: '<p>v2</p>' });
    await artifactService.update(created.id, { content: '<p>v3</p>' });

    const listed = await revisionService.list(projectId, 'artifact', created.id);
    expect(listed).toHaveLength(3);

    const oldest = listed?.[2];
    expect(oldest).toBeDefined();
    if (!oldest) return;
    const full = await revisionService.get(oldest.id);
    expect(full?.snapshot).toMatchObject({ title: 'Screen', content: '<p>v0</p>', kind: 'html' });

    const againstCurrent = await revisionService.diff(oldest.id, 'current');
    expect(againstCurrent?.some((d) => d.field === 'content')).toBe(true);

    const restored = await revisionService.restore(oldest.id);
    expect(restored).toMatchObject({ id: created.id, content: '<p>v0</p>' });
    const live = await artifactService.get(created.id);
    expect(live?.content).toBe('<p>v0</p>');
    expect(live?.revision_id).toBeTruthy();
  });

  it('restore re-runs link extraction so prototype_links match restored markup', async () => {
    const { artifactService, revisionService } = services();
    const proto = await createPrototypeService({ db, orgId }).create(projectId, {
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) return;

    const target = await artifactService.create(projectId, {
      title: 'Payment',
      kind: 'html',
      content: '<p>pay</p>',
      prototypeId: proto.id,
    });
    const screen = await artifactService.create(projectId, {
      title: 'Home',
      kind: 'html',
      content: '<a href="plandesk://artifact/Payment">pay</a>',
      prototypeId: proto.id,
    });
    expect(target && screen).toBeTruthy();
    if (!target || !screen) return;

    const linksV0 = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(linksV0).toHaveLength(1);
    expect(linksV0[0]?.toArtifactId).toBe(target.id);

    await artifactService.update(screen.id, {
      content: '<a href="plandesk://artifact/Missing">gone</a>',
    });
    const linksV1 = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(linksV1).toHaveLength(1);
    expect(linksV1[0]?.toArtifactId).toBeNull();

    const listed = await revisionService.list(projectId, 'artifact', screen.id);
    expect(listed?.length).toBeGreaterThanOrEqual(1);
    const prior = listed?.[listed.length - 1];
    expect(prior).toBeDefined();
    if (!prior) return;

    await revisionService.restore(prior.id);
    const linksRestored = await listPrototypeLinksByFromArtifact(db, screen.id);
    expect(linksRestored).toHaveLength(1);
    expect(linksRestored[0]?.rawTarget).toContain('Payment');
    expect(linksRestored[0]?.toArtifactId).toBe(target.id);
  });

  it('retention cap applies to artifacts exactly as to documents', async () => {
    const { artifactService } = services(3);
    const created = await artifactService.create(projectId, {
      title: 'Capped',
      kind: 'markdown',
      content: 'v0',
    });
    expect(created).toBeDefined();
    if (!created) return;

    await artifactService.update(created.id, { content: 'v1' });
    await artifactService.update(created.id, { content: 'v2' });
    await artifactService.update(created.id, { content: 'v3' });
    expect(await listRevisionsByTarget(db, projectId, 'artifact', created.id)).toHaveLength(3);

    await artifactService.update(created.id, { content: 'v4' });
    const after = await listRevisionsByTarget(db, projectId, 'artifact', created.id);
    expect(after).toHaveLength(3);
    expect(after.map((r) => (JSON.parse(r.snapshot) as { content?: string }).content)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });

  it('task and document revisions are unaffected', async () => {
    const { taskService, documentService } = services(2);
    const task = await taskService.create(projectId, {
      label: 'T',
      description: 't0',
    });
    expect(task).toBeDefined();
    if (!task) return;
    await taskService.update(task.id, { description: 't1' });
    await taskService.update(task.id, { description: 't2' });
    await taskService.update(task.id, { description: 't3' });
    expect(await listRevisionsByTarget(db, projectId, 'task', task.id)).toHaveLength(2);

    const doc = await documentService.create(projectId, { title: 'D', body: 'd0' });
    expect(doc).toBeDefined();
    if (!doc) return;
    await documentService.update(doc.id, { body: 'd1' });
    await documentService.update(doc.id, { body: 'd2' });
    await documentService.update(doc.id, { body: 'd3' });
    expect(await listRevisionsByTarget(db, projectId, 'document', doc.id)).toHaveLength(2);
  });

  it('surfaces revision_id on the artifact read model after a versioned write', async () => {
    const { artifactService } = services();
    const created = await artifactService.create(projectId, {
      title: 'Rev id',
      kind: 'html',
      content: '<p>a</p>',
    });
    expect(created?.revision_id).toBeTruthy();
    if (!created) return;

    const updated = await artifactService.update(created.id, { content: '<p>b</p>' });
    expect(updated?.revision_id).toBeTruthy();
    expect(updated?.revision_id).not.toBe(created.revision_id);

    const listed = await listRevisionsByTarget(db, projectId, 'artifact', created.id);
    expect(listed).toHaveLength(1);
    expect(updated?.revision_id).toBe(listed[0]?.id);
  });
});
