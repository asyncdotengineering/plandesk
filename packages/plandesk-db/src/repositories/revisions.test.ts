import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createDocument } from './documents.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import {
  deleteRevisionsByProjectId,
  deleteRevisionsByTarget,
  evictRevisionsBeyondCap,
  getRevision,
  insertRevision,
  listRevisionsByTarget,
  reportRevisionUsage,
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

  it('fetches a revision by id', async () => {
    const mine = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: JSON.stringify({ label: 'Before' }),
      changedFields: JSON.stringify(['label']),
      author: 'human:user-1',
    });
    expect(await getRevision(db, mine.id)).toEqual(mine);
    expect(await getRevision(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
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

  it('evicts oldest-first beyond the cap for one target only', async () => {
    const t0 = new Date('2020-01-01T00:00:00.000Z');
    const a0 = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: 'a0',
      changedFields: '[]',
      author: 'system',
      createdAt: new Date(t0.getTime()),
    });
    const a1 = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: 'a1',
      changedFields: '[]',
      author: 'system',
      createdAt: new Date(t0.getTime() + 1000),
    });
    const a2 = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: 'a2',
      changedFields: '[]',
      author: 'system',
      createdAt: new Date(t0.getTime() + 2000),
    });
    const other = await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: otherTaskId,
      snapshot: 'other',
      changedFields: '[]',
      author: 'system',
      createdAt: new Date(t0.getTime()),
    });

    expect(await evictRevisionsBeyondCap(db, 'task', taskId, 2)).toBe(1);
    const kept = await listRevisionsByTarget(db, projectId, 'task', taskId);
    expect(kept.map((r) => r.id)).toEqual([a1.id, a2.id]);
    expect(kept.map((r) => r.id)).not.toContain(a0.id);
    expect(await listRevisionsByTarget(db, projectId, 'task', otherTaskId)).toEqual([other]);
  });

  it('reports revision usage with per-target bytes and database share', async () => {
    await insertRevision(db, {
      projectId,
      targetType: 'task',
      targetId: taskId,
      snapshot: 'xxxx',
      changedFields: '[]',
      author: 'system',
    });
    await insertRevision(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      snapshot: 'yy',
      changedFields: '[]',
      author: 'system',
    });

    const report = await reportRevisionUsage(db);
    expect(report.revisionCount).toBe(2);
    expect(report.snapshotBytes).toBe(6);
    expect(report.databaseBytes).toBeGreaterThan(0);
    expect(report.snapshotShareOfDatabase).toBe(report.snapshotBytes / report.databaseBytes);
    expect(report.perTarget).toHaveLength(2);
    expect(report.perTarget.find((row) => row.targetId === taskId)?.snapshotBytes).toBe(4);
    expect(report.perTarget.find((row) => row.targetId === documentId)?.snapshotBytes).toBe(2);
  });
});
