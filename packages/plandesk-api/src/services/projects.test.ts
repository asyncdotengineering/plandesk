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
import { createEventBus } from '../events.js';
import { createProjectService } from './projects.js';

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
});
