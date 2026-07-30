import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createEdge,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createTaskService } from './tasks.js';

describe('blocked state on list (derived prerequisites)', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  function createService() {
    return createTaskService({ db, orgId });
  }

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    await db.$client.execute('DELETE FROM edges');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM task_tags');
    await db.$client.execute('DELETE FROM tags');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    const project = await createProject(db, { name: 'Project' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('serializes blocked when B depends_on open A; clears when A is done', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A', status: 'todo' });
    const b = await createTask(db, { projectId, label: 'B', status: 'todo' });
    await createEdge(db, {
      projectId,
      fromTaskId: b.id,
      toTaskId: a.id,
      label: 'depends_on',
    });

    const listedBlocked = await service.listByProject(projectId);
    const serializedB = listedBlocked?.find((task) => task.id === b.id);
    expect(serializedB).toMatchObject({
      blocked: true,
      waiting_on: [a.id],
    });
    const nextWhileBlocked = await service.nextActionable(projectId);
    expect(nextWhileBlocked?.next_task?.id).not.toBe(b.id);
    expect(nextWhileBlocked?.blocked.some((entry) => entry.task.id === b.id)).toBe(true);

    await service.update(a.id, { status: 'done' });

    const listedReady = await service.listByProject(projectId);
    const readyB = listedReady?.find((task) => task.id === b.id);
    expect(readyB).toMatchObject({ blocked: false, waiting_on: [] });
    const nextReady = await service.nextActionable(projectId);
    expect(nextReady?.next_task?.id).toBe(b.id);
  });

  it('never reports blocked for a task with no inbound prerequisite', async () => {
    const service = createService();
    const lone = await createTask(db, { projectId, label: 'Lone', status: 'todo' });
    const listed = await service.listByProject(projectId);
    expect(listed?.find((task) => task.id === lone.id)).toMatchObject({
      blocked: false,
      waiting_on: [],
    });
  });

  it('ignores a self-edge — it does not block', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Self', status: 'todo' });
    await createEdge(db, { projectId, fromTaskId: task.id, toTaskId: task.id, label: 'blocks' });
    const listed = await service.listByProject(projectId);
    expect(listed?.find((row) => row.id === task.id)).toMatchObject({
      blocked: false,
      waiting_on: [],
    });
  });

  it('ignores an edge with a non-task endpoint', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Doc-linked', status: 'todo' });
    const doc = await createDocument(db, { projectId, title: 'Spec' });
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: doc.id,
      toType: 'task',
      toId: task.id,
      label: 'blocks',
    });
    const listed = await service.listByProject(projectId);
    expect(listed?.find((row) => row.id === task.id)).toMatchObject({
      blocked: false,
      waiting_on: [],
    });
  });

  it('agrees with nextActionable blocked[] for every todo in an active goal', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A', status: 'todo' });
    const b = await createTask(db, { projectId, label: 'B', status: 'todo' });
    const c = await createTask(db, { projectId, label: 'C', status: 'todo' });
    await createEdge(db, {
      projectId,
      fromTaskId: b.id,
      toTaskId: a.id,
      label: 'depends_on',
    });
    await createEdge(db, {
      projectId,
      fromTaskId: c.id,
      toTaskId: b.id,
      label: 'depends_on',
    });

    const listed = await service.listByProject(projectId);
    expect(listed).toBeDefined();
    if (!listed) {
      throw new Error('expected listed tasks');
    }
    const next = await service.nextActionable(projectId);
    expect(next).toBeDefined();
    if (!next) {
      throw new Error('expected nextActionable result');
    }

    const blockedIds = new Set(next.blocked.map((entry) => entry.task.id));
    for (const task of listed.filter((row) => row.status === 'todo')) {
      expect(task.blocked).toBe(blockedIds.has(task.id));
    }
  });

  it('superset: scope task with open prereq is blocked on list but absent from nextActionable blocked[]', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A', status: 'todo' });
    const scoped = await createTask(db, { projectId, label: 'Scoped', status: 'scope' });
    await createEdge(db, {
      projectId,
      fromTaskId: scoped.id,
      toTaskId: a.id,
      label: 'depends_on',
    });

    const listed = await service.listByProject(projectId);
    expect(listed?.find((task) => task.id === scoped.id)).toMatchObject({
      blocked: true,
      waiting_on: [a.id],
    });

    const next = await service.nextActionable(projectId);
    expect(next?.blocked.some((entry) => entry.task.id === scoped.id)).toBe(false);
    expect(next?.next_task?.id).toBe(a.id);
  });
});
