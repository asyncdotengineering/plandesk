import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createDb,
  createDocument,
  createDocumentComment,
  createEdge,
  createProject,
  createShare,
  createTask,
  migrate,
} from '@plandesk/db';
import { buildClientView } from './projection.js';

describe('buildClientView', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM document_comments');
    db.$client.exec('DELETE FROM agent_run_events');
    db.$client.exec('DELETE FROM agent_runs');
    db.$client.exec('DELETE FROM shares');
    db.$client.exec('DELETE FROM edges');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
  });

  it('projection_no_internal: omits agent runs, comments, assignee, and description by default', () => {
    const project = createProject(db, { name: 'Portal', description: 'Client view' });
    const sharedTask = createTask(db, {
      projectId: project.id,
      label: 'Shared',
      status: 'todo',
      description: 'Internal details',
      assignee: 'agent@internal',
    });
    const hiddenTask = createTask(db, {
      projectId: project.id,
      label: 'Hidden',
      status: 'done',
      description: 'Secret',
      assignee: 'owner@internal',
    });
    createEdge(db, {
      projectId: project.id,
      fromTaskId: sharedTask.id,
      toTaskId: hiddenTask.id,
      label: 'blocks',
    });
    const sharedDoc = createDocument(db, {
      projectId: project.id,
      title: 'Shared spec',
      body: '<p>Visible</p>',
    });
    createDocument(db, {
      projectId: project.id,
      title: 'Internal notes',
      body: '<p>Secret</p>',
    });
    createDocumentComment(db, { documentId: sharedDoc.id, body: 'Internal comment' });
    createAgentRun(db, { projectId: project.id, label: 'Internal run' });

    const { share } = createShare(db, {
      projectId: project.id,
      audienceName: 'Acme',
      permissions: { read: true, submit: false },
      policy: {
        tasks: [sharedTask.id],
        documentIds: [sharedDoc.id],
        fields: {},
      },
    });

    const view = buildClientView(db, project.id, share);
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

  it('includes edges only when both endpoints are shared', () => {
    const project = createProject(db, { name: 'Edges' });
    const a = createTask(db, { projectId: project.id, label: 'A' });
    const b = createTask(db, { projectId: project.id, label: 'B' });
    const c = createTask(db, { projectId: project.id, label: 'C' });
    const ab = createEdge(db, {
      projectId: project.id,
      fromTaskId: a.id,
      toTaskId: b.id,
      label: 'ab',
    });
    createEdge(db, {
      projectId: project.id,
      fromTaskId: b.id,
      toTaskId: c.id,
      label: 'bc',
    });

    const { share } = createShare(db, {
      projectId: project.id,
      audienceName: 'Edge test',
      permissions: { read: true, submit: false },
      policy: { tasks: [a.id, b.id], documentIds: [], fields: {} },
    });

    const view = buildClientView(db, project.id, share);
    expect(view?.edges).toEqual([{ id: ab.id, from: a.id, to: b.id, label: 'ab' }]);
  });

  it('includes assignee and description when policy fields opt in', () => {
    const project = createProject(db, { name: 'Fields' });
    const task = createTask(db, {
      projectId: project.id,
      label: 'Open',
      description: 'Details',
      assignee: 'client@example.com',
    });

    const { share } = createShare(db, {
      projectId: project.id,
      audienceName: 'Fields',
      permissions: { read: true, submit: false },
      policy: {
        tasks: 'all',
        documentIds: [],
        fields: { assignee: true, description: true },
      },
    });

    const view = buildClientView(db, project.id, share);
    expect(view?.tasks[0]).toMatchObject({
      id: task.id,
      description: 'Details',
      assignee: 'client@example.com',
    });
  });

  it('returns undefined when the project is missing', () => {
    const project = createProject(db, { name: 'Ghost' });
    const { share } = createShare(db, {
      projectId: project.id,
      audienceName: 'Ghost',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    db.$client.exec('DELETE FROM shares');
    db.$client.exec('DELETE FROM projects');

    expect(buildClientView(db, project.id, share)).toBeUndefined();
  });
});
