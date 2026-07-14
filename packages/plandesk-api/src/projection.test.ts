import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createDb,
  createDocument,
  createComment,
  createEdge,
  createProjectInDefaultOrg as createProject,
  createShare,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { buildClientView } from './projection.js';

describe('buildClientView', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    await db.$client.execute('DELETE FROM comments');
    await db.$client.execute('DELETE FROM agent_run_events');
    await db.$client.execute('DELETE FROM agent_runs');
    await db.$client.execute('DELETE FROM shares');
    await db.$client.execute('DELETE FROM edges');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
  });

  it('projection_no_internal: omits agent runs, comments, assignee, and description by default', async () => {
    const project = await createProject(db, { name: 'Portal', description: 'Client view' });
    const sharedTask = await createTask(db, {
      projectId: project.id,
      label: 'Shared',
      status: 'todo',
      description: 'Internal details',
      assignee: 'agent@internal',
    });
    const hiddenTask = await createTask(db, {
      projectId: project.id,
      label: 'Hidden',
      status: 'done',
      description: 'Secret',
      assignee: 'owner@internal',
    });
    await createEdge(db, {
      projectId: project.id,
      fromTaskId: sharedTask.id,
      toTaskId: hiddenTask.id,
      label: 'blocks',
    });
    const sharedDoc = await createDocument(db, {
      projectId: project.id,
      title: 'Shared spec',
      body: '<p>Visible</p>',
    });
    await createDocument(db, {
      projectId: project.id,
      title: 'Internal notes',
      body: '<p>Secret</p>',
    });
    await createComment(db, {
      projectId: project.id,
      targetType: 'document',
      targetId: sharedDoc.id,
      body: 'Internal comment',
    });
    await createAgentRun(db, { projectId: project.id, label: 'Internal run' });

    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Acme',
      permissions: { read: true, submit: false },
      policy: {
        tasks: [sharedTask.id],
        documentIds: [sharedDoc.id],
        fields: {},
      },
    });

    const view = await buildClientView(db, project.id, share);
    expect(view).toBeDefined();

    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/agent/i);
    expect(serialized).not.toMatch(/comment/i);
    expect(serialized).not.toMatch(/token_hash/i);
    expect(serialized).not.toMatch(/Internal details/);
    expect(serialized).not.toMatch(/agent@internal/);
    expect(serialized).not.toMatch(/Internal notes/);
    expect(serialized).not.toMatch(/Secret/);

    expect(view?.tasks).toHaveLength(1);
    expect(view?.tasks[0]).toMatchObject({
      id: sharedTask.id,
      label: 'Shared',
      status: 'todo',
    });
    expect(view?.tasks[0]).not.toHaveProperty('assignee');
    expect(view?.tasks[0]).not.toHaveProperty('description');

    expect(view?.edges).toHaveLength(0);
    expect(view?.documents).toHaveLength(1);
    expect(view?.documents[0]).toMatchObject({
      id: sharedDoc.id,
      title: 'Shared spec',
      body_html: '<p>Visible</p>',
    });
    expect(view?.progress).toEqual({ todo: 1 });
    expect(view?.share).toMatchObject({
      audience_name: 'Acme',
      permissions: { read: true, submit: false },
    });
  });

  it('includes edges only when both endpoints are shared', async () => {
    const project = await createProject(db, { name: 'Edges' });
    const a = await createTask(db, { projectId: project.id, label: 'A' });
    const b = await createTask(db, { projectId: project.id, label: 'B' });
    const c = await createTask(db, { projectId: project.id, label: 'C' });
    const ab = await createEdge(db, {
      projectId: project.id,
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'ab',
    });
    await createEdge(db, {
      projectId: project.id,
      fromTaskId: b.id,
      toTaskId: c.id,
      label: 'bc',
    });

    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Edge test',
      permissions: { read: true, submit: false },
      policy: { tasks: [a.id, b.id], documentIds: [], fields: {} },
    });

    const view = await buildClientView(db, project.id, share);
    expect(view?.edges).toEqual([{ id: ab.id, from: a.id, to: b.id, label: 'ab' }]);
  });

  it('includes assignee and description when policy fields opt in', async () => {
    const project = await createProject(db, { name: 'Fields' });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Open',
      description: 'Details',
      assignee: 'client@example.com',
    });

    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Fields',
      permissions: { read: true, submit: false },
      policy: {
        tasks: 'all',
        documentIds: [],
        fields: { assignee: true, description: true },
      },
    });

    const view = await buildClientView(db, project.id, share);
    expect(view?.tasks[0]).toMatchObject({
      id: task.id,
      description: 'Details',
      assignee: 'client@example.com',
    });
  });

  it('returns undefined when the project is missing', async () => {
    const project = await createProject(db, { name: 'Ghost' });
    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Ghost',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    await db.$client.execute('DELETE FROM shares');
    await db.$client.execute('DELETE FROM projects');

    expect(await buildClientView(db, project.id, share)).toBeUndefined();
  });
});
