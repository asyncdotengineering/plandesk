import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createEdge, createProjectInDefaultOrg as createProject, getTask, listEdges, migrate , type Db} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createCanvasService, InvalidCanvasError } from './canvas.js';

describe('canvasService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
    let projectId = '';
  let orgId = '';

  function createService() {
    return createCanvasService({ db, orgId });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM edges');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    const project = await createProject(db, { name: 'Canvas' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('returns canvas nodes, edges, and layout', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Node', x: 10, y: 20 });
    await createEdge(db, {
      projectId,
      fromTaskId: task.id,
      toTaskId: task.id,
      label: 'feeds',
    });

    const canvas = await service.get(projectId);
    expect(canvas?.nodes).toHaveLength(1);
    expect(canvas?.nodes[0]).toMatchObject({ id: task.id, x: 10, y: 20 });
    expect(canvas?.edges[0]).toMatchObject({
      from_task_id: task.id,
      to_task_id: task.id,
      label: 'feeds',
    });
    expect(canvas?.layout).toBeNull();
  });

  it('putLayout creates nodes and reconciles edges', async () => {
    const service = createService();
    const nodeA = '11111111-1111-4111-8111-111111111111';
    const nodeB = '22222222-2222-4222-8222-222222222222';
    const nodeC = '33333333-3333-4333-8333-333333333333';
    const edgeId = '44444444-4444-4444-8444-444444444444';

    await service.putLayout(projectId, {
      nodes: [
        { id: nodeA, label: 'A', x: 1, y: 2 },
        { id: nodeB, label: 'B', x: 3, y: 4 },
        { id: nodeC, label: 'C', x: 5, y: 6 },
      ],
      edges: [
        {
          id: edgeId,
          from_task_id: nodeA,
          to_task_id: nodeB,
          label: 'blocks',
        },
        {
          from_task_id: nodeB,
          to_task_id: nodeC,
          label: 'depends_on',
        },
      ],
      layout: { zoom: 1.2 },
    });

    const canvas = await service.get(projectId);
    expect(canvas?.nodes).toHaveLength(3);
    expect(canvas?.edges).toHaveLength(2);
    expect(canvas?.layout).toEqual({ zoom: 1.2 });
  });

  it('putLayout updates only x/y for existing nodes', async () => {
    const service = createService();
    const task = await createTask(db, {
      projectId,
      label: 'Original',
      status: 'in_progress',
      description: 'Keep me',
      x: 0,
      y: 0,
    });

    await service.putLayout(projectId, {
      nodes: [{ id: task.id, x: 99, y: 88, label: 'Stale', status: 'todo' }],
      edges: [],
    });

    const updated = await getTask(db, task.id);
    expect(updated?.x).toBe(99);
    expect(updated?.y).toBe(88);
    expect(updated?.label).toBe('Original');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.description).toBe('Keep me');
  });

  it('deletes edges removed from the payload', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A' });
    const b = await createTask(db, { projectId, label: 'B' });
    const stale = await createEdge(db, {
      projectId,
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'remove-me',
    });

    await service.putLayout(projectId, {
      nodes: [
        { id: a.id, x: 1, y: 1 },
        { id: b.id, x: 2, y: 2 },
      ],
      edges: [],
    });

    expect(await listEdges(db, projectId)).toHaveLength(0);
    expect(stale.id).toBeDefined();
  });

  it('rejects edges referencing missing tasks', async () => {
    const service = createService();
    await expect(service.putLayout(projectId, {
        nodes: [],
        edges: [
          {
            from_task_id: '00000000-0000-4000-8000-000000009999',
            to_task_id: '00000000-0000-4000-8000-000000009998',
          },
        ],
      }),).rejects.toThrow(InvalidCanvasError);
  });

  it('createEdge adds an edge', async () => {
    const service = createCanvasService({ db, orgId });
    const a = await createTask(db, { projectId, label: 'A' });
    const b = await createTask(db, { projectId, label: 'B' });

    const edge = await service.createEdge(projectId, {
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'blocks',
    });
    expect(edge).toMatchObject({
      from_task_id: a.id,
      to_task_id: b.id,
      label: 'blocks',
    });
  });

  it('createEdge rejects tasks outside the project', async () => {
    const service = createService();
    const otherProjectId = (await createProject(db, { name: 'Other' })).id;
    const foreign = await createTask(db, { projectId: otherProjectId, label: 'Foreign' });
    const local = await createTask(db, { projectId, label: 'Local' });
    await expect(service.createEdge(projectId, {
        fromTaskId: foreign.id,
        toTaskId: local.id,
      }),).rejects.toThrow(InvalidCanvasError);
  });

  it('requires label for new nodes', async () => {
    const service = createService();
    await expect(service.putLayout(projectId, {
        nodes: [{ x: 1, y: 2 }],
        edges: [],
      }),).rejects.toThrow(InvalidCanvasError);
  });

  it('listEdges returns edges with from/to/label for a project (#29)', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A' });
    const b = await createTask(db, { projectId, label: 'B' });
    const edge = await service.createEdge(projectId, {
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'blocks',
    });

    const edges = await service.listEdges(projectId);
    expect(edges).toEqual([
      expect.objectContaining({ id: edge?.id, from_task_id: a.id, to_task_id: b.id, label: 'blocks' }),
    ]);
  });

  it('listEdges returns undefined for a missing project', async () => {
    const service = createService();
    expect(await service.listEdges('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('deleteEdgeById removes an edge without requiring project_id (#29)', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A' });
    const b = await createTask(db, { projectId, label: 'B' });
    const edge = await service.createEdge(projectId, { fromTaskId: a.id, toTaskId: b.id });
    if (!edge) {
      throw new Error('expected edge');
    }

    expect(await service.deleteEdgeById(edge.id)).toBe(true);
    expect(await listEdges(db, projectId)).toHaveLength(0);
  });

  it('deleteEdgeById returns false for a missing edge', async () => {
    const service = createService();
    expect(await service.deleteEdgeById('00000000-0000-4000-8000-000000009999')).toBe(false);
  });
});
