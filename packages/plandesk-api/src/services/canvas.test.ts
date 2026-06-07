import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createEdge,
  createProject,
  createTask,
  getTask,
  listEdges,
  migrate,
} from '@plandesk/db';
import { createEventBus } from '../events.js';
import { createCanvasService, InvalidCanvasError } from './canvas.js';

describe('canvasService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createCanvasService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM edges');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Canvas' }).id;
  });

  it('returns canvas nodes, edges, and layout', () => {
    const service = createService();
    const task = createTask(db, { projectId, label: 'Node', x: 10, y: 20 });
    createEdge(db, {
      projectId,
      fromTaskId: task.id,
      toTaskId: task.id,
      label: 'feeds',
    });

    const canvas = service.get(projectId);
    expect(canvas?.nodes).toHaveLength(1);
    expect(canvas?.nodes[0]).toMatchObject({ id: task.id, x: 10, y: 20 });
    expect(canvas?.edges[0]).toMatchObject({
      from_task_id: task.id,
      to_task_id: task.id,
      label: 'feeds',
    });
    expect(canvas?.layout).toBeNull();
  });

  it('putLayout creates nodes and reconciles edges', () => {
    const service = createService();
    const nodeA = '11111111-1111-4111-8111-111111111111';
    const nodeB = '22222222-2222-4222-8222-222222222222';
    const nodeC = '33333333-3333-4333-8333-333333333333';
    const edgeId = '44444444-4444-4444-8444-444444444444';

    service.putLayout(projectId, {
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

    const canvas = service.get(projectId);
    expect(canvas?.nodes).toHaveLength(3);
    expect(canvas?.edges).toHaveLength(2);
    expect(canvas?.layout).toEqual({ zoom: 1.2 });
  });

  it('putLayout updates only x/y for existing nodes', () => {
    const service = createService();
    const task = createTask(db, {
      projectId,
      label: 'Original',
      status: 'in_progress',
      description: 'Keep me',
      x: 0,
      y: 0,
    });

    service.putLayout(projectId, {
      nodes: [{ id: task.id, x: 99, y: 88, label: 'Stale', status: 'todo' }],
      edges: [],
    });

    const updated = getTask(db, task.id);
    expect(updated?.x).toBe(99);
    expect(updated?.y).toBe(88);
    expect(updated?.label).toBe('Original');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.description).toBe('Keep me');
  });

  it('deletes edges removed from the payload', () => {
    const service = createService();
    const a = createTask(db, { projectId, label: 'A' });
    const b = createTask(db, { projectId, label: 'B' });
    const stale = createEdge(db, {
      projectId,
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'remove-me',
    });

    service.putLayout(projectId, {
      nodes: [
        { id: a.id, x: 1, y: 1 },
        { id: b.id, x: 2, y: 2 },
      ],
      edges: [],
    });

    expect(listEdges(db, projectId)).toHaveLength(0);
    expect(stale.id).toBeDefined();
  });

  it('rejects edges referencing missing tasks', () => {
    const service = createService();
    expect(() =>
      service.putLayout(projectId, {
        nodes: [],
        edges: [
          {
            from_task_id: '00000000-0000-4000-8000-000000009999',
            to_task_id: '00000000-0000-4000-8000-000000009998',
          },
        ],
      }),
    ).toThrow(InvalidCanvasError);
  });

  it('requires label for new nodes', () => {
    const service = createService();
    expect(() =>
      service.putLayout(projectId, {
        nodes: [{ x: 1, y: 2 }],
        edges: [],
      }),
    ).toThrow(InvalidCanvasError);
  });
});
