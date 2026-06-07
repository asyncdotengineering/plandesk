import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createEdge, deleteEdge, getEdge, listEdges, updateEdge } from './edges.js';
import { createProject } from './projects.js';
import { createTask } from './tasks.js';

describe('edges repository', () => {
  const db = createDb(':memory:');
  let projectId = '';
  let fromTaskId = '';
  let toTaskId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM edges');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Edge Project' }).id;
    fromTaskId = createTask(db, { projectId, label: 'From' }).id;
    toTaskId = createTask(db, { projectId, label: 'To' }).id;
  });

  it('creates and lists edges for a project', () => {
    const created = createEdge(db, {
      projectId,
      fromTaskId,
      toTaskId,
      label: 'blocks',
      arrowDirection: 'forward',
      style: 'solid',
    });

    expect(getEdge(db, created.id)).toEqual(created);
    expect(listEdges(db, projectId)).toEqual([created]);
  });

  it('updates an edge', () => {
    const created = createEdge(db, {
      projectId,
      fromTaskId,
      toTaskId,
      label: 'depends_on',
    });

    const updated = updateEdge(db, created.id, {
      label: 'unblocks',
      arrowDirection: 'both',
    });

    expect(updated?.label).toBe('unblocks');
    expect(updated?.arrowDirection).toBe('both');
  });

  it('deletes an edge', () => {
    const created = createEdge(db, {
      projectId,
      fromTaskId,
      toTaskId,
    });

    expect(deleteEdge(db, created.id)).toBe(true);
    expect(getEdge(db, created.id)).toBeUndefined();
    expect(deleteEdge(db, created.id)).toBe(false);
  });
});
