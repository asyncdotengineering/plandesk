import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createAgentRunEvent,
  createDb,
  createDocument,
  createComment,
  createEdge,
  createProjectInDefaultOrg as createProject,
  ensureDefaultOrg,
  getDocument,
  getComment,
  getProject,
  getTask,
  listAgentRuns,
  listCommentsByProject,
  listDocuments,
  listEdges,
  listTasks,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createProjectService, InvalidScaffoldError } from './projects.js';

describe('projectService', () => {
  let db: Db;
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    orgId = (await ensureDefaultOrg(db)).id;
    await db.$client.execute('DELETE FROM comments');
    await db.$client.execute('DELETE FROM agent_run_events');
    await db.$client.execute('DELETE FROM agent_runs');
    await db.$client.execute('DELETE FROM edges');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
  });

  function createService() {
    return createProjectService({ db, orgId });
  }

  it('creates and lists projects with ISO timestamps', async () => {
    const service = createService();
    const created = await service.create({ name: 'Alpha', description: 'First project' });
    expect(created.name).toBe('Alpha');
    expect(created.description).toBe('First project');
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const projects = await service.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
  });

  it('returns project detail with task counts by status', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Counts' });
    orgId = project.orgId;
    await createTask(db, { projectId: project.id, label: 'A', status: 'todo' });
    await createTask(db, { projectId: project.id, label: 'B', status: 'todo' });
    await createTask(db, { projectId: project.id, label: 'C', status: 'done' });

    const detail = await service.get(project.id);
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

  it('returns undefined for a missing project', async () => {
    const service = createService();
    expect(await service.get('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates a project name and description', async () => {
    const service = createService();
    const created = await service.create({ name: 'Before', description: 'Old' });
    const updated = await service.update(created.id, { name: 'After', description: 'New' });
    expect(updated).toMatchObject({ id: created.id, name: 'After', description: 'New' });
  });

  it('returns undefined when updating a missing project', async () => {
    const service = createService();
    expect(
      await service.update('00000000-0000-4000-8000-000000009999', { name: 'Ghost' }),
    ).toBeUndefined();
  });

  it('paginates project list', async () => {
    const service = createService();
    await service.create({ name: 'A' });
    await service.create({ name: 'B' });
    await service.create({ name: 'C' });
    expect(await service.list({ limit: 2, offset: 1 })).toHaveLength(2);
    expect((await service.list({ limit: 2, offset: 1 }))[0]?.name).toBe('B');
  });

  it('cascade deletes project children in FK-safe order', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Cascade' });
    const task = await createTask(db, { projectId: project.id, label: 'Task' });
    const edge = await createEdge(db, {
      projectId: project.id,
      fromTaskId: task.id,
      toTaskId: task.id,
    });
    const doc = await createDocument(db, {
      projectId: project.id,
      title: 'Doc',
      linkedTaskId: task.id,
    });
    const comment = await createComment(db, {
      projectId: project.id,
      targetType: 'document',
      targetId: doc.id,
      body: 'Feedback',
    });
    const run = await createAgentRun(db, { projectId: project.id, label: 'Run' });
    createAgentRunEvent(db, { runId: run.id, message: 'progress' });

    expect(await service.delete(project.id)).toBe(true);
    expect(await getProject(db, project.id)).toBeUndefined();
    expect(await listTasks(db, project.id)).toHaveLength(0);
    expect(await listEdges(db, project.id)).toHaveLength(0);
    expect(await listDocuments(db, project.id)).toHaveLength(0);
    expect(await listCommentsByProject(db, project.id, { includeResolved: true })).toHaveLength(0);
    expect(await listAgentRuns(db, project.id)).toHaveLength(0);
    expect(await getTask(db, task.id)).toBeUndefined();
    expect(await getDocument(db, doc.id)).toBeUndefined();
    expect(await getComment(db, comment.id)).toBeUndefined();
    expect(edge).toBeDefined();
  });

  it('returns false when deleting a missing project', async () => {
    const service = createService();
    expect(await service.delete('00000000-0000-4000-8000-000000009999')).toBe(false);
  });

  it('scaffolds a project with tasks, edges, and documents atomically', async () => {
    const service = createProjectService({ db, orgId });

    const result = await service.scaffoldFromPlan({
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
    expect(await listTasks(db, result.project.id)).toHaveLength(3);
    expect(await listEdges(db, result.project.id)).toHaveLength(1);
    expect(await listDocuments(db, result.project.id)).toHaveLength(1);
  });

  it('scaffolds into an existing project when project_id is given (no new project)', async () => {
    const service = createService();
    const existing = await createProject(db, { name: 'Existing' });
    const result = await service.scaffoldFromPlan({
      projectId: existing.id,
      tasks: [
        { key: 'a', label: 'Task A' },
        { key: 'b', label: 'Task B' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'blocks' }],
      documents: [{ title: 'Spec', body: '# Plan', linkTo: 'a' }],
    });
    // Targets the bound project, never creates a duplicate.
    expect(result.project.id).toBe(existing.id);
    expect(result.counts).toEqual({ tasks: 2, edges: 1, documents: 1 });
    expect(await listTasks(db, existing.id)).toHaveLength(2);
    expect(await listEdges(db, existing.id)).toHaveLength(1);
    expect(await listDocuments(db, existing.id)).toHaveLength(1);
  });

  it('offsets new task rows below existing nodes in a non-empty project', async () => {
    const service = createService();
    const existing = await createProject(db, { name: 'Existing' });
    await createTask(db, { projectId: existing.id, label: 'Old', x: 0, y: 320 });
    const result = await service.scaffoldFromPlan({
      projectId: existing.id,
      tasks: [{ key: 'n', label: 'New' }],
    });
    // maxY 320 → startRow = floor(320/160)+1 = 3 → y = 480, clear of the old node.
    expect(result.tasks[0]).toMatchObject({ x: 0, y: 480 });
  });

  it('rejects scaffolding into a missing project and persists nothing', async () => {
    const service = createService();
    await expect(
      service.scaffoldFromPlan({ projectId: 'nope', tasks: [{ key: 'a', label: 'A' }] }),
    ).rejects.toThrow(InvalidScaffoldError);
  });

  it('rejects a new-project scaffold with no name', async () => {
    const service = createService();
    await expect(service.scaffoldFromPlan({ tasks: [{ key: 'a', label: 'A' }] })).rejects.toThrow(
      InvalidScaffoldError,
    );
  });

  it('assigns grid positions when x and y are omitted', async () => {
    const service = createService();
    const result = await service.scaffoldFromPlan({
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

  it('rejects duplicate task keys and persists nothing', async () => {
    const service = createService();
    await expect(service.scaffoldFromPlan({
        name: 'Dup',
        tasks: [
          { key: 'dup', label: 'One' },
          { key: 'dup', label: 'Two' },
        ],
      }),).rejects.toThrow(InvalidScaffoldError);
    expect(await service.list()).toHaveLength(0);
  });

  it('rejects unknown edge keys and persists nothing', async () => {
    const service = createService();
    await expect(service.scaffoldFromPlan({
        name: 'Bad edge',
        tasks: [{ key: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'missing' }],
      }),).rejects.toThrow(InvalidScaffoldError);
    expect(await service.list()).toHaveLength(0);
  });

  it('rejects self-edges and persists nothing', async () => {
    const service = createService();
    await expect(service.scaffoldFromPlan({
        name: 'Self',
        tasks: [{ key: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'a' }],
      }),).rejects.toThrow(InvalidScaffoldError);
    expect(await service.list()).toHaveLength(0);
  });
});
