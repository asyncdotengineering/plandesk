import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createEdge, deleteEdge, getEdge, listEdges, updateEdge } from './edges.js';
import { createProject } from './projects.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';

describe('edges repository', () => {
  let db: Db;
  let projectId = '';
  let fromTaskId = '';
  let toTaskId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Edge Project' })).id;
    fromTaskId = (await createTask(db, { projectId, label: 'From' })).id;
    toTaskId = (await createTask(db, { projectId, label: 'To' })).id;
  });

  it('creates and lists edges for a project', async () => {
    const created = await createEdge(db, {
      projectId,
      fromTaskId,
      toTaskId,
      label: 'blocks',
      arrowDirection: 'forward',
      style: 'solid',
    });

    expect(await getEdge(db, created.id)).toEqual(created);
    expect(await listEdges(db, projectId)).toEqual([created]);
  });

  it('updates an edge', async () => {
    const created = await createEdge(db, {
      projectId,
      fromTaskId,
      toTaskId,
      label: 'depends_on',
    });

    const updated = await updateEdge(db, created.id, {
      label: 'unblocks',
      arrowDirection: 'both',
    });

    expect(updated?.label).toBe('unblocks');
    expect(updated?.arrowDirection).toBe('both');
  });

  it('deletes an edge', async () => {
    const created = await createEdge(db, {
      projectId,
      fromTaskId,
      toTaskId,
    });

    expect(await deleteEdge(db, created.id)).toBe(true);
    expect(await getEdge(db, created.id)).toBeUndefined();
    expect(await deleteEdge(db, created.id)).toBe(false);
  });
});
