import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createProject, createTask, migrate } from '@plandesk/db';
import { createProjectService } from './projects.js';

describe('projectService', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
  });

  it('creates and lists projects with ISO timestamps', () => {
    const service = createProjectService({ db });
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
    const service = createProjectService({ db });
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
    const service = createProjectService({ db });
    expect(service.get('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });
});
