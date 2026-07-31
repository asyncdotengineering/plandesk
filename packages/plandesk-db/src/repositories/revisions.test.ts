import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createDocument } from './documents.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import {
  deleteRevisionsByProjectId,
  deleteRevisionsByTarget,
  insertRevision,
  listRevisionsByTarget,
} from './revisions.js';

describe('revisions repository', () => {
  let db: Db;
  let projectId = '';
  let taskId = '';
  let otherTaskId = '';
  let documentId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Revisions' })).id;
    taskId = (await createTask(db, { projectId, label: 'Task A' })).id;
    otherTaskId = (await createTask(db, { projectId, label: 'Task B' })).id;
    documentId = (await createDocument(db, { projectId, title: 'Doc' })).id;
  });

  it('lists revisions for a target scoped to project and target', async () => {
    const mine = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: JSON.stringify({ label: 'Before' }),
      changedFields: JSON.stringify(['label']),
      author: 'human:user-1',
    });
    await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: otherTaskId,
      snapshot: JSON.stringify({ label: 'Other' }),
      changedFields: JSON.stringify(['label']),
      author: 'human:user-1',
    });

    const listed = await listRevisionsByTarget(db, projectId, 'task', taskId);
    expect(listed.map((r) => r.id)).toEqual([mine.id]);
  });

  it('deletes revisions by target without affecting other targets', async () => {
    const keep = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: otherTaskId,
      snapshot: '{}',
      changedFields: '[]',
      author: 'system',
    });
    await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: '{}',
      changedFields: '[]',
      author: 'system',
    });

    expect(await deleteRevisionsByTarget(db, 'task', taskId)).toBe(1);
    expect(await listRevisionsByTarget(db, projectId, 'task', taskId)).toHaveLength(0);
    expect(await listRevisionsByTarget(db, projectId, 'task', otherTaskId)).toEqual([keep]);
  });

  it('deletes all revisions for a project', async () => {
    await insertRevision(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      snapshot: '{}',
      changedFields: '[]',
      author: 'system',
    });
    await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: '{}',
      changedFields: '[]',
      author: 'system',
    });

    expect(await deleteRevisionsByProjectId(db, projectId)).toBe(2);
    expect(await listRevisionsByTarget(db, projectId, 'task', taskId)).toHaveLength(0);
    expect(await listRevisionsByTarget(db, projectId, 'document', documentId)).toHaveLength(0);
  });

  it('tolerates orphan target ids on read', async () => {
    const orphan = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: '00000000-0000-4000-8000-000000009999',
      snapshot: '{}',
      changedFields: '[]',
      author: 'system',
    });

    const listed = await listRevisionsByTarget(
      db,
      projectId,
      'task',
      '00000000-0000-4000-8000-000000009999',
    );
    expect(listed).toEqual([orphan]);
  });
});
