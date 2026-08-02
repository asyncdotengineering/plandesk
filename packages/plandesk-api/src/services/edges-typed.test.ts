import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createEdge,
  createArtifact,
  createPrototype,
  createProjectInDefaultOrg as createProject,
  getEdge,
  listEdges,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createCanvasService, InvalidCanvasError } from './canvas.js';

/**
 * Typed edge service — dual-write + adversarial isolation.
 * One test per isolation case (not one representative).
 */
describe('typed edge service', () => {
  let db: Db;
  let orgId = '';
  let projectAId = '';
  let projectBId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const projectA = await createProject(db, { name: 'Project A' });
    const projectB = await createProject(db, { name: 'Project B' });
    projectAId = projectA.id;
    projectBId = projectB.id;
    orgId = projectA.orgId;
  });

  function service() {
    return createCanvasService({ db, orgId });
  }

  it('task→task edge writes typed columns only', async () => {
    const a = await createTask(db, { projectId: projectAId, label: 'A' });
    const b = await createTask(db, { projectId: projectAId, label: 'B' });

    const created = await service().createEdge(projectAId, {
      fromType: 'task',
      fromId: a.id,
      toType: 'task',
      toId: b.id,
      label: 'blocks',
    });
    expect(created).toBeDefined();
    if (!created) {
      throw new Error('expected edge');
    }

    const row = await getEdge(db, created.id);
    expect(row).toMatchObject({
      fromType: 'task',
      fromId: a.id,
      toType: 'task',
      toId: b.id,
      label: 'blocks',
    });
    expect(created).toMatchObject({
      from_type: 'task',
      from_id: a.id,
      to_type: 'task',
      to_id: b.id,
    });
  });

  it('task-shaped createEdge still maps to typed columns', async () => {
    const a = await createTask(db, { projectId: projectAId, label: 'A' });
    const b = await createTask(db, { projectId: projectAId, label: 'B' });

    const created = await service().createEdge(projectAId, {
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'depends_on',
    });
    expect(created).toBeDefined();
    if (!created) {
      throw new Error('expected edge');
    }

    const row = await getEdge(db, created.id);
    expect(row).toMatchObject({
      fromType: 'task',
      fromId: a.id,
      toType: 'task',
      toId: b.id,
    });
  });

  it('creates a task→document edge with typed columns', async () => {
    const task = await createTask(db, { projectId: projectAId, label: 'Task' });
    const doc = await createDocument(db, { projectId: projectAId, title: 'Doc' });

    const created = await service().createEdge(projectAId, {
      fromType: 'task',
      fromId: task.id,
      toType: 'document',
      toId: doc.id,
      label: 'documents',
    });
    expect(created).toBeDefined();
    if (!created) {
      throw new Error('expected edge');
    }

    const row = await getEdge(db, created.id);
    expect(row).toMatchObject({
      fromType: 'task',
      fromId: task.id,
      toType: 'document',
      toId: doc.id,
    });
  });

  it('refuses create when to is a document in another project (workspace B stand-in)', async () => {
    const taskA = await createTask(db, { projectId: projectAId, label: 'A task' });
    const docB = await createDocument(db, { projectId: projectBId, title: 'B doc' });

    await expect(
      service().createEdge(projectAId, {
        fromType: 'task',
        fromId: taskA.id,
        toType: 'document',
        toId: docB.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    expect(await listEdges(db, projectAId)).toHaveLength(0);
  });

  it('refuses create when to is a task in another project (workspace B stand-in)', async () => {
    const taskA = await createTask(db, { projectId: projectAId, label: 'A task' });
    const taskB = await createTask(db, { projectId: projectBId, label: 'B task' });

    await expect(
      service().createEdge(projectAId, {
        fromType: 'task',
        fromId: taskA.id,
        toType: 'task',
        toId: taskB.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    expect(await listEdges(db, projectAId)).toHaveLength(0);
  });

  it('refuses create across two projects inside the same workspace/org', async () => {
    // projectA and projectB share orgId from createProjectInDefaultOrg.
    const fromA = await createTask(db, { projectId: projectAId, label: 'From A' });
    const toB = await createTask(db, { projectId: projectBId, label: 'To B' });

    await expect(
      service().createEdge(projectAId, {
        fromType: 'task',
        fromId: fromA.id,
        toType: 'task',
        toId: toB.id,
        label: 'blocks',
      }),
    ).rejects.toThrow(InvalidCanvasError);

    await expect(
      service().createEdge(projectBId, {
        fromType: 'task',
        fromId: fromA.id,
        toType: 'task',
        toId: toB.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);
  });

  it('refuses an id whose real type differs from the claimed type', async () => {
    const task = await createTask(db, { projectId: projectAId, label: 'Real task' });
    const doc = await createDocument(db, { projectId: projectAId, title: 'Real doc' });

    // Task id claimed as document.
    await expect(
      service().createEdge(projectAId, {
        fromType: 'task',
        fromId: task.id,
        toType: 'document',
        toId: task.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    // Document id claimed as task.
    await expect(
      service().createEdge(projectAId, {
        fromType: 'document',
        fromId: doc.id,
        toType: 'task',
        toId: doc.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    expect(await listEdges(db, projectAId)).toHaveLength(0);
  });

  it('refuses an unknown entity type rather than storing it', async () => {
    const task = await createTask(db, { projectId: projectAId, label: 'T' });

    await expect(
      service().createEdge(projectAId, {
        fromType: 'note' as 'task',
        fromId: task.id,
        toType: 'task',
        toId: task.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);
  });

  it('cannot list edges for a document endpoint in another project', async () => {
    const taskB = await createTask(db, { projectId: projectBId, label: 'B task' });
    const docB = await createDocument(db, { projectId: projectBId, title: 'B doc' });
    await createEdge(db, {
      projectId: projectBId,
      fromType: 'task',
      fromId: taskB.id,
      toType: 'document',
      toId: docB.id,
    });

    // Caller scoped to project A cannot list by B's document endpoint under A.
    expect(
      await service().listEdgesForEndpoint(projectAId, 'document', docB.id),
    ).toBeUndefined();

    // Listing under B works for the same org-scoped service (project isolation
    // is the gate; workspace isolation is covered by the HTTP audit suites).
    const listed = await service().listEdgesForEndpoint(projectBId, 'document', docB.id);
    expect(listed).toHaveLength(1);
    expect(listed?.[0]).toMatchObject({
      from_type: 'task',
      from_id: taskB.id,
      to_type: 'document',
      to_id: docB.id,
    });
  });

  it('cannot delete an edge whose endpoints live in another project', async () => {
    const taskB = await createTask(db, { projectId: projectBId, label: 'B task' });
    const docB = await createDocument(db, { projectId: projectBId, title: 'B doc' });
    const edge = await createEdge(db, {
      projectId: projectBId,
      fromType: 'task',
      fromId: taskB.id,
      toType: 'document',
      toId: docB.id,
    });

    // By id under the wrong project → not found.
    expect(await service().deleteEdge(projectAId, edge.id)).toBe(false);
    expect(await getEdge(db, edge.id)).toBeDefined();

    // By typed endpoints under the wrong project → refused.
    expect(
      await service().deleteEdgeByEndpoints(projectAId, {
        fromType: 'task',
        fromId: taskB.id,
        toType: 'document',
        toId: docB.id,
      }),
    ).toBe(false);
    expect(await getEdge(db, edge.id)).toBeDefined();

    // Correct project succeeds.
    expect(
      await service().deleteEdgeByEndpoints(projectBId, {
        fromType: 'task',
        fromId: taskB.id,
        toType: 'document',
        toId: docB.id,
      }),
    ).toBe(true);
    expect(await getEdge(db, edge.id)).toBeUndefined();
  });

  it('cannot list a foreign project edge from the caller project surface', async () => {
    const taskB = await createTask(db, { projectId: projectBId, label: 'B' });
    const taskB2 = await createTask(db, { projectId: projectBId, label: 'B2' });
    await createEdge(db, {
      projectId: projectBId,
      fromType: 'task',
      fromId: taskB.id,
      toType: 'task',
      toId: taskB2.id,
    });

    const edgesA = await service().listEdges(projectAId);
    expect(edgesA).toEqual([]);

    const edgesB = await service().listEdges(projectBId);
    expect(edgesB).toHaveLength(1);
  });

  it('putLayout does not delete polymorphic document edges', async () => {
    const task = await createTask(db, { projectId: projectAId, label: 'T', x: 1, y: 1 });
    const doc = await createDocument(db, { projectId: projectAId, title: 'D' });
    const docEdge = await createEdge(db, {
      projectId: projectAId,
      fromType: 'task',
      fromId: task.id,
      toType: 'document',
      toId: doc.id,
      label: 'documents',
    });

    await service().putLayout(projectAId, {
      nodes: [{ id: task.id, x: 2, y: 2 }],
      edges: [],
    });

    expect(await getEdge(db, docEdge.id)).toBeDefined();
    expect(await listEdges(db, projectAId)).toHaveLength(1);
  });

  it('creates prototype→task and artifact→document edges that round-trip via listEdges', async () => {
    const task = await createTask(db, { projectId: projectAId, label: 'Realise me' });
    const doc = await createDocument(db, { projectId: projectAId, title: 'Spec' });
    const prototype = await createPrototype(db, {
      projectId: projectAId,
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const artifact = await createArtifact(db, {
      projectId: projectAId,
      title: 'Screen A',
      kind: 'html',
      content: '<html></html>',
    });

    const protoEdge = await service().createEdge(projectAId, {
      fromType: 'prototype',
      fromId: prototype.id,
      toType: 'task',
      toId: task.id,
      label: 'supports',
    });
    const artifactEdge = await service().createEdge(projectAId, {
      fromType: 'artifact',
      fromId: artifact.id,
      toType: 'document',
      toId: doc.id,
      label: 'documents',
    });
    expect(protoEdge).toBeDefined();
    expect(artifactEdge).toBeDefined();
    if (!protoEdge || !artifactEdge) {
      throw new Error('expected edges');
    }
    expect(protoEdge).toMatchObject({
      from_type: 'prototype',
      from_id: prototype.id,
      to_type: 'task',
      to_id: task.id,
    });
    expect(artifactEdge).toMatchObject({
      from_type: 'artifact',
      from_id: artifact.id,
      to_type: 'document',
      to_id: doc.id,
    });

    const listed = await service().listEdges(projectAId);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: protoEdge.id, from_type: 'prototype' }),
        expect.objectContaining({ id: artifactEdge.id, from_type: 'artifact' }),
      ]),
    );

    // Canvas nodes are tasks only — these edges must not appear as dangling.
    const canvas = await service().get(projectAId);
    expect(canvas?.edges.find((edge) => edge.id === protoEdge.id)).toBeUndefined();
    expect(canvas?.edges.find((edge) => edge.id === artifactEdge.id)).toBeUndefined();
  });

  it('refuses a cross-project prototype or artifact endpoint', async () => {
    const taskA = await createTask(db, { projectId: projectAId, label: 'A' });
    const docA = await createDocument(db, { projectId: projectAId, title: 'A doc' });
    const prototypeB = await createPrototype(db, {
      projectId: projectBId,
      name: 'Foreign',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const artifactB = await createArtifact(db, {
      projectId: projectBId,
      title: 'Foreign screen',
      kind: 'html',
      content: '<html></html>',
    });

    await expect(
      service().createEdge(projectAId, {
        fromType: 'prototype',
        fromId: prototypeB.id,
        toType: 'task',
        toId: taskA.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    await expect(
      service().createEdge(projectAId, {
        fromType: 'artifact',
        fromId: artifactB.id,
        toType: 'document',
        toId: docA.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    expect(await listEdges(db, projectAId)).toHaveLength(0);
  });

  // The `to` side is the branch nobody thinks about, so it gets its own case
  // rather than riding on code symmetry with the `from` side above.
  it('refuses a cross-project prototype or artifact endpoint on the to side', async () => {
    const taskA = await createTask(db, { projectId: projectAId, label: 'A' });
    const docA = await createDocument(db, { projectId: projectAId, title: 'A doc' });
    const prototypeB = await createPrototype(db, {
      projectId: projectBId,
      name: 'Foreign',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const artifactB = await createArtifact(db, {
      projectId: projectBId,
      title: 'Foreign screen',
      kind: 'html',
      content: '<html></html>',
    });

    await expect(
      service().createEdge(projectAId, {
        fromType: 'task',
        fromId: taskA.id,
        toType: 'prototype',
        toId: prototypeB.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    await expect(
      service().createEdge(projectAId, {
        fromType: 'document',
        fromId: docA.id,
        toType: 'artifact',
        toId: artifactB.id,
      }),
    ).rejects.toThrow(InvalidCanvasError);

    expect(await listEdges(db, projectAId)).toHaveLength(0);
  });

  it('putLayout does not delete prototype or artifact edges', async () => {
    const task = await createTask(db, { projectId: projectAId, label: 'T', x: 1, y: 1 });
    const doc = await createDocument(db, { projectId: projectAId, title: 'D' });
    const prototype = await createPrototype(db, {
      projectId: projectAId,
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const artifact = await createArtifact(db, {
      projectId: projectAId,
      title: 'Screen',
      kind: 'html',
      content: '<html></html>',
    });
    const protoEdge = await createEdge(db, {
      projectId: projectAId,
      fromType: 'prototype',
      fromId: prototype.id,
      toType: 'task',
      toId: task.id,
    });
    const artifactEdge = await createEdge(db, {
      projectId: projectAId,
      fromType: 'artifact',
      fromId: artifact.id,
      toType: 'document',
      toId: doc.id,
    });

    await service().putLayout(projectAId, {
      nodes: [{ id: task.id, x: 3, y: 3 }],
      edges: [],
    });

    expect(await getEdge(db, protoEdge.id)).toBeDefined();
    expect(await getEdge(db, artifactEdge.id)).toBeDefined();
  });
});
