import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createAgentRunEvent,
  createDb,
  createDocument,
  createEdge,
  createProject,
  createTask,
  getDocument,
  getProject,
  getTask,
  listAgentRuns,
  listDocuments,
  listEdges,
  listTasks,
  migrate,
} from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createProjectService, InvalidScaffoldError } from './projects.js';

describe('projectService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM agent_run_events');
    db.$client.exec('DELETE FROM agent_runs');
    db.$client.exec('DELETE FROM edges');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
  });

  function createService() {
    return createProjectService({ db, eventBus });
  }

  it('creates and lists projects with ISO timestamps', () => {
    const service = createService();
    const created = service.create({ name: 'Alpha', description: 'First project' });
    expect(created.name).toBe('Alpha');
    expect(created.description).toBe('First project');
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const projects = service.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
  });

  it('returns project detail with task counts by status', () => {
    const service = createService();
    const project = createProject(db, { name: 'Counts' });
    createTask(db, { projectId: project.id, label: 'A', status: 'todo' });
    createTask(db, { projectId: project.id, label: 'B', status: 'todo' });
    createTask(db, { projectId: project.id, label: 'C', status: 'done' });

    const detail = service.get(project.id);
    expect(detail).toMatchObject({
      id: project.id,
      name: 'Counts',
      summary: {
        scope: 0,
        todo: 2,
        in_progress: 0,
        done: 1,
        backlog: 0,
      },
    });
  });

  it('returns undefined for a missing project', () => {
    const service = createService();
    expect(service.get('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates a project name and description', () => {
    const service = createService();
    const created = service.create({ name: 'Before', description: 'Old' });
    const updated = service.update(created.id, { name: 'After', description: 'New' });
    expect(updated).toMatchObject({ id: created.id, name: 'After', description: 'New' });
  });

  it('returns undefined when updating a missing project', () => {
    const service = createService();
    expect(
      service.update('00000000-0000-4000-8000-000000009999', { name: 'Ghost' }),
    ).toBeUndefined();
  });

  it('paginates project list', () => {
    const service = createService();
    service.create({ name: 'A' });
    service.create({ name: 'B' });
    service.create({ name: 'C' });
    expect(service.list({ limit: 2, offset: 1 })).toHaveLength(2);
    expect(service.list({ limit: 2, offset: 1 })[0]?.name).toBe('B');
  });

  it('cascade deletes project children in FK-safe order', () => {
    const service = createService();
    const project = createProject(db, { name: 'Cascade' });
    const task = createTask(db, { projectId: project.id, label: 'Task' });
    const edge = createEdge(db, {
      projectId: project.id,
      fromTaskId: task.id,
      toTaskId: task.id,
    });
    const doc = createDocument(db, {
      projectId: project.id,
      title: 'Doc',
      linkedTaskId: task.id,
    });
    const run = createAgentRun(db, { projectId: project.id, label: 'Run' });
    createAgentRunEvent(db, { runId: run.id, message: 'progress' });

    expect(service.delete(project.id)).toBe(true);
    expect(getProject(db, project.id)).toBeUndefined();
    expect(listTasks(db, project.id)).toHaveLength(0);
    expect(listEdges(db, project.id)).toHaveLength(0);
    expect(listDocuments(db, project.id)).toHaveLength(0);
    expect(listAgentRuns(db, project.id)).toHaveLength(0);
    expect(getTask(db, task.id)).toBeUndefined();
    expect(getDocument(db, doc.id)).toBeUndefined();
    expect(edge).toBeDefined();
  });

  it('returns false when deleting a missing project', () => {
    const service = createService();
    expect(service.delete('00000000-0000-4000-8000-000000009999')).toBe(false);
  });

  it('scaffolds a project with tasks, edges, and documents atomically', () => {
    const bus = createEventBus();
    const service = createProjectService({ db, eventBus: bus });
    const received: PlankDeskEvent[] = [];
    bus.subscribe((event) => {
      received.push(event);
    });

    const result = service.scaffoldFromPlan({
      name: 'Scaffolded',
      description: 'From plan',
      tasks: [
        { key: 'a', label: 'Task A', status: 'done' },
        { key: 'b', label: 'Task B' },
        { key: 'c', label: 'Task C' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'blocks' }],
      documents: [{ title: 'Spec', body: '# Plan', linkTo: 'b', statusLine: 'Draft' }],
    });

    expect(result.project.name).toBe('Scaffolded');
    expect(result.counts).toEqual({ tasks: 3, edges: 1, documents: 1 });
    expect(typeof result.key_to_id.a).toBe('string');
    expect(typeof result.key_to_id.b).toBe('string');
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[1]).toMatchObject({ label: 'Task B', x: 240, y: 0 });
    expect(result.edges[0]).toMatchObject({
      from_task_id: result.key_to_id.a,
      to_task_id: result.key_to_id.b,
      label: 'blocks',
    });
    expect(result.documents[0]).toMatchObject({
      title: 'Spec',
      linked_task_id: result.key_to_id.b,
    });
    expect(listTasks(db, result.project.id)).toHaveLength(3);
    expect(listEdges(db, result.project.id)).toHaveLength(1);
    expect(listDocuments(db, result.project.id)).toHaveLength(1);
    expect(received.filter((e) => e.type === 'canvas_updated')).toHaveLength(1);
    expect(received.filter((e) => e.type === 'document_created')).toHaveLength(1);
  });

  it('assigns grid positions when x and y are omitted', () => {
    const service = createService();
    const result = service.scaffoldFromPlan({
      name: 'Grid',
      tasks: [
        { key: 't0', label: '0' },
        { key: 't1', label: '1' },
        { key: 't2', label: '2' },
        { key: 't3', label: '3' },
        { key: 't4', label: '4' },
      ],
    });
    expect(result.tasks[0]).toMatchObject({ x: 0, y: 0 });
    expect(result.tasks[1]).toMatchObject({ x: 240, y: 0 });
    expect(result.tasks[2]).toMatchObject({ x: 480, y: 0 });
    expect(result.tasks[4]).toMatchObject({ x: 0, y: 160 });
  });

  it('rejects duplicate task keys and persists nothing', () => {
    const service = createService();
    expect(() =>
      service.scaffoldFromPlan({
        name: 'Dup',
        tasks: [
          { key: 'dup', label: 'One' },
          { key: 'dup', label: 'Two' },
        ],
      }),
    ).toThrow(InvalidScaffoldError);
    expect(service.list()).toHaveLength(0);
  });

  it('rejects unknown edge keys and persists nothing', () => {
    const service = createService();
    expect(() =>
      service.scaffoldFromPlan({
        name: 'Bad edge',
        tasks: [{ key: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'missing' }],
      }),
    ).toThrow(InvalidScaffoldError);
    expect(service.list()).toHaveLength(0);
  });

  it('rejects self-edges and persists nothing', () => {
    const service = createService();
    expect(() =>
      service.scaffoldFromPlan({
        name: 'Self',
        tasks: [{ key: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'a' }],
      }),
    ).toThrow(InvalidScaffoldError);
    expect(service.list()).toHaveLength(0);
  });
});
