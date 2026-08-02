import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ORG_ID,
  createAgentRun,
  createAgentRunEvent,
  createArtifact,
  createDb,
  createDocument,
  createComment,
  createEdge,
  createGoal,
  createProjectInDefaultOrg as createProject,
  createPrototype,
  getArtifact,
  getDocument,
  getComment,
  getOrCreateDefaultGoal,
  AmbiguousActiveGoalsError,
  getProject,
  getPrototype,
  getTask,
  insertRevision,
  listAgentRuns,
  listArtifactsByProject,
  listCommentsByProject,
  listDocuments,
  listEdges,
  listPrototypes,
  listRevisionsByTarget,
  listTasks,
  migrate,
  type Db,
  type GoalStatus,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createBetterAuth, runBetterAuthMigrations } from '../better-auth.js';
import { createTeamForOrg, ensureLocalBetterAuthOrganization } from '../identity.js';
import { runWithAuthContext, type AuthContext } from '../auth-context.js';
import { DEFAULT_AGENT_KEY_PERMISSIONS } from '../agent-keys.js';
import { createProjectService, InvalidScaffoldError, InvalidOverviewDocumentError } from './projects.js';
import { createTaskService, InvalidGoalReferenceError } from './tasks.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

describe('projectService', () => {
  let db: Db;
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    orgId = DEFAULT_ORG_ID;
    await db.$client.execute('DELETE FROM comments');
    await db.$client.execute('DELETE FROM agent_run_events');
    await db.$client.execute('DELETE FROM agent_runs');
    await db.$client.execute('DELETE FROM edges');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
  });

  async function createService() {
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth !== undefined) {
      await runBetterAuthMigrations(auth);
      await ensureLocalBetterAuthOrganization(db, auth);
    }
    return createProjectService({ db, orgId, auth });
  }

  async function createWorkspaceBoundService() {
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) {
      throw new Error('expected better-auth');
    }
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);
    const workspace = await createTeamForOrg(auth, orgId, 'Bound workspace');
    return {
      service: createProjectService({ db, orgId, auth }),
      workspaceId: workspace.id,
    };
  }

  async function backdateGoal(goalId: string, offsetMs: number) {
    await db.$client.execute({
      sql: 'UPDATE goals SET created_at = ? WHERE id = ?',
      args: [Date.now() - offsetMs, goalId],
    });
  }

  async function seedOldestInactiveGoal(
    projectId: string,
    status: GoalStatus,
    objective: string,
  ) {
    const inactive = await createGoal(db, {
      projectId,
      objective,
      status,
      id: `11111111-1111-4111-8111-${status === 'complete' ? '111111111111' : status === 'paused' ? '222222222222' : '333333333333'}`,
    });
    await backdateGoal(inactive.id, 20_000);
    const active = await createGoal(db, {
      projectId,
      objective: 'Active cycle',
      status: 'active',
      id: '44444444-4444-4444-8444-444444444444',
    });
    return { inactive, active };
  }

  it('creates and lists projects with ISO timestamps', async () => {
    const service = await createService();
    const created = await service.create({ name: 'Alpha', description: 'First project' });
    expect(created.name).toBe('Alpha');
    expect(created.description).toBe('First project');
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const projects = await service.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
  });

  it('keeps create_project and scaffold_project_from_plan in the bound workspace', async () => {
    const { service, workspaceId } = await createWorkspaceBoundService();
    const context: AuthContext = {
      kind: 'apikey',
      orgId,
      userId: 'bound-workspace-user',
      profile: 'agent',
      workspaceId,
      role: 'owner',
      permission: DEFAULT_AGENT_KEY_PERMISSIONS,
    };

    const created = await runWithAuthContext(context, () =>
      service.create({ name: 'Bound create_project' }),
    );
    expect(created.workspace_id).toBe(workspaceId);
    expect((await runWithAuthContext(context, () => service.list())).map((p) => p.id)).toContain(
      created.id,
    );

    const scaffold = await runWithAuthContext(context, () =>
      service.scaffoldFromPlan({
        name: 'Bound scaffold_project_from_plan',
        tasks: [{ key: 'setup', label: 'Setup' }],
      }),
    );
    expect(scaffold.project.workspace_id).toBe(workspaceId);
    expect(
      (await runWithAuthContext(context, () => service.list())).map((p) => p.id),
    ).toContain(scaffold.project.id);

    const roundTrip = await runWithAuthContext(context, () =>
      service.scaffoldFromPlan({
        projectId: scaffold.project.id,
        tasks: [{ key: 'build', label: 'Build' }],
      }),
    );
    expect(roundTrip.project.id).toBe(scaffold.project.id);
    expect(roundTrip.tasks).toHaveLength(1);
  });

  it('returns project detail with task counts by status', async () => {
    const service = await createService();
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
    const service = await createService();
    expect(await service.get('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates a project name and description', async () => {
    const service = await createService();
    const created = await service.create({ name: 'Before', description: 'Old' });
    const updated = await service.update(created.id, { name: 'After', description: 'New' });
    expect(updated).toMatchObject({ id: created.id, name: 'After', description: 'New' });
  });

  it('owner and overview: set, clear with null, omit leaves unchanged; rejects cross-project overview', async () => {
    const service = await createService();
    const created = await service.create({ name: 'Owned', ownerId: 'ada' });
    expect(created.owner_id).toBe('ada');
    expect(created.overview_document_id).toBeNull();

    const doc = await createDocument(db, { projectId: created.id, title: 'Overview' });
    const other = await createProject(db, { name: 'Other board' });
    const foreignDoc = await createDocument(db, { projectId: other.id, title: 'Foreign' });

    const set = await service.update(created.id, {
      overviewDocumentId: doc.id,
      ownerId: 'bob',
    });
    expect(set).toMatchObject({ owner_id: 'bob', overview_document_id: doc.id });

    const cleared = await service.update(created.id, {
      ownerId: null,
      overviewDocumentId: null,
    });
    expect(cleared).toMatchObject({ owner_id: null, overview_document_id: null });

    await service.update(created.id, { ownerId: 'cara', overviewDocumentId: doc.id });
    const omitted = await service.update(created.id, { name: 'Still Owned' });
    expect(omitted).toMatchObject({
      name: 'Still Owned',
      owner_id: 'cara',
      overview_document_id: doc.id,
    });

    await expect(
      service.update(created.id, { overviewDocumentId: foreignDoc.id }),
    ).rejects.toThrow(InvalidOverviewDocumentError);
  });

  it('REVERT-PROOF: cross-org get/update of owner and overview is denied', async () => {
    const service = await createService();
    const home = await service.create({ name: 'Home', ownerId: 'ada' });
    const doc = await createDocument(db, { projectId: home.id, title: 'Spec' });
    await service.update(home.id, { overviewDocumentId: doc.id });

    const otherOrgId = '00000000-0000-4000-8000-00000000bbbb';
    const foreignService = createProjectService({ db, orgId: otherOrgId });

    expect(await foreignService.get(home.id)).toBeUndefined();
    expect(
      await foreignService.update(home.id, { ownerId: 'intruder', overviewDocumentId: null }),
    ).toBeUndefined();

    const stored = await getProject(db, home.id);
    expect(stored?.ownerId).toBe('ada');
    expect(stored?.overviewDocumentId).toBe(doc.id);
  });

  it('deleting a project that pins an overview document still succeeds', async () => {
    const service = await createService();
    const project = await service.create({ name: 'With overview' });
    const doc = await createDocument(db, { projectId: project.id, title: 'Pinned' });
    await service.update(project.id, { overviewDocumentId: doc.id });

    expect(await service.delete(project.id)).toBe(true);
    expect(await getProject(db, project.id)).toBeUndefined();
    expect(await getDocument(db, doc.id)).toBeUndefined();
  });

  it('returns undefined when updating a missing project', async () => {
    const service = await createService();
    expect(
      await service.update('00000000-0000-4000-8000-000000009999', { name: 'Ghost' }),
    ).toBeUndefined();
  });

  it('paginates project list', async () => {
    const service = await createService();
    await service.create({ name: 'A' });
    await service.create({ name: 'B' });
    await service.create({ name: 'C' });
    expect(await service.list({ limit: 2, offset: 1 })).toHaveLength(2);
    expect((await service.list({ limit: 2, offset: 1 }))[0]?.name).toBe('B');
  });

  it('cascade deletes project children in FK-safe order', async () => {
    const service = await createService();
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
    });
    const comment = await createComment(db, {
      projectId: project.id,
      targetType: 'document',
      targetId: doc.id,
      body: 'Feedback',
    });
    const run = await createAgentRun(db, { projectId: project.id, label: 'Run' });
    await createAgentRunEvent(db, { runId: run.id, message: 'progress' });
    await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: task.id,
      snapshot: '{}',
      changedFields: '[]',
      author: 'system',
    });

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
    expect(await listRevisionsByTarget(db, project.id, 'task', task.id)).toHaveLength(0);
    expect(edge).toBeDefined();
  });

  it('deletes a project that owns a prototype and HTML screen', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'With prototype' });
    const proto = await createPrototype(db, {
      projectId: project.id,
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screen = await createArtifact(db, {
      projectId: project.id,
      title: 'Home',
      kind: 'html',
      content: '<html></html>',
      prototypeId: proto.id,
      x: 40,
      y: 80,
    });

    expect(await service.delete(project.id)).toBe(true);
    expect(await getProject(db, project.id)).toBeUndefined();
    expect(await getPrototype(db, proto.id)).toBeUndefined();
    expect(await getArtifact(db, screen.id)).toBeUndefined();
    expect(await listPrototypes(db, project.id)).toHaveLength(0);
    expect(await listArtifactsByProject(db, project.id)).toHaveLength(0);
  });

  it('returns false when deleting a missing project', async () => {
    const service = await createService();
    expect(await service.delete('00000000-0000-4000-8000-000000009999')).toBe(false);
  });

  it('scaffolds a project with tasks, edges, and documents atomically', async () => {
    const service = await createService();

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
      from_type: 'task',
      from_id: result.key_to_id.a,
      to_type: 'task',
      to_id: result.key_to_id.b,
      label: 'blocks',
    });
    expect(result.documents[0]).toMatchObject({
      title: 'Spec',
      links: [
        {
          type: 'task',
          id: result.key_to_id.b,
          title: 'Task B',
          label: 'documents',
        },
      ],
    });
    expect(await listTasks(db, result.project.id)).toHaveLength(3);
    // Plan edge (task→task) + dual-written document→task link edge.
    expect(await listEdges(db, result.project.id)).toHaveLength(2);
    expect(await listDocuments(db, result.project.id)).toHaveLength(1);
  });

  it('scaffolds into an existing project when project_id is given (no new project)', async () => {
    const service = await createService();
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
    // Plan edge + dual-written document→task link edge.
    expect(await listEdges(db, existing.id)).toHaveLength(2);
    expect(await listDocuments(db, existing.id)).toHaveLength(1);
  });

  it('offsets new task rows below existing nodes in a non-empty project', async () => {
    const service = await createService();
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
    const service = await createService();
    await expect(
      service.scaffoldFromPlan({ projectId: 'nope', tasks: [{ key: 'a', label: 'A' }] }),
    ).rejects.toThrow(InvalidScaffoldError);
  });

  it('rejects a new-project scaffold with no name', async () => {
    const service = await createService();
    await expect(service.scaffoldFromPlan({ tasks: [{ key: 'a', label: 'A' }] })).rejects.toThrow(
      InvalidScaffoldError,
    );
  });

  it('assigns grid positions when x and y are omitted', async () => {
    const service = await createService();
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
    const service = await createService();
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
    const service = await createService();
    await expect(service.scaffoldFromPlan({
        name: 'Bad edge',
        tasks: [{ key: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'missing' }],
      }),).rejects.toThrow(InvalidScaffoldError);
    expect(await service.list()).toHaveLength(0);
  });

  it('rejects self-edges and persists nothing', async () => {
    const service = await createService();
    await expect(service.scaffoldFromPlan({
        name: 'Self',
        tasks: [{ key: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'a' }],
      }),).rejects.toThrow(InvalidScaffoldError);
    expect(await service.list()).toHaveLength(0);
  });

  it('scaffolds tasks onto an explicit goal and they are reachable by nextActionable', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'Multi-goal' });
    const targetGoal = await createGoal(db, {
      projectId: project.id,
      objective: 'Target cycle',
      status: 'active',
    });
    await getOrCreateDefaultGoal(db, project.id);

    const result = await service.scaffoldFromPlan({
      projectId: project.id,
      goalId: targetGoal.id,
      tasks: [
        { key: 'a', label: 'Task A', status: 'todo' },
        { key: 'b', label: 'Task B', status: 'todo' },
      ],
    });

    const scaffoldedIds = new Set(Object.values(result.key_to_id));
    const persisted = await listTasks(db, project.id);
    for (const task of persisted) {
      if (scaffoldedIds.has(task.id)) {
        expect(task.goalId).toBe(targetGoal.id);
      }
    }

    const taskService = createTaskService({ db, orgId });
    const next = await taskService.nextActionable(project.id);
    expect(next?.reason).toBe('ok');
    expect(next?.next_task?.goal_id).toBe(targetGoal.id);
    expect(scaffoldedIds.has(next?.next_task?.id ?? '')).toBe(true);
  });

  it('scaffolds onto the default goal when goal_id is omitted', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'Default goal' });
    await createGoal(db, { projectId: project.id, objective: 'Other', status: 'active' });
    const defaultGoal = await getOrCreateDefaultGoal(db, project.id);

    const result = await service.scaffoldFromPlan({
      projectId: project.id,
      tasks: [{ key: 'a', label: 'Task A' }],
    });

    const taskId = result.key_to_id.a;
    expect(taskId).toBeTruthy();
    const task = await getTask(db, taskId as string);
    expect(task?.goalId).toBe(defaultGoal.id);
  });

  it('rejects an unknown or cross-project goal_id when scaffolding', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'Home' });
    const foreign = await createProject(db, { name: 'Foreign' });
    const foreignGoal = await createGoal(db, {
      projectId: foreign.id,
      objective: 'Foreign goal',
      status: 'active',
    });

    await expect(
      service.scaffoldFromPlan({
        projectId: project.id,
        goalId: foreignGoal.id,
        tasks: [{ key: 'a', label: 'A' }],
      }),
    ).rejects.toThrow(InvalidGoalReferenceError);

    await expect(
      service.scaffoldFromPlan({
        projectId: project.id,
        goalId: '00000000-0000-4000-8000-000000009999',
        tasks: [{ key: 'a', label: 'A' }],
      }),
    ).rejects.toThrow(InvalidGoalReferenceError);

    expect(await listTasks(db, project.id)).toHaveLength(0);
  });

  it.each(['complete', 'paused', 'blocked'] as const)(
    'scaffolds onto the active goal when the oldest goal is %s and tasks are reachable by nextActionable',
    async (inactiveStatus) => {
      const service = await createService();
      const project = await createProject(db, { name: `Oldest ${inactiveStatus}` });
      const { active } = await seedOldestInactiveGoal(project.id, inactiveStatus, 'Old cycle');

      const result = await service.scaffoldFromPlan({
        projectId: project.id,
        tasks: [
          { key: 'a', label: 'Task A', status: 'todo' },
          { key: 'b', label: 'Task B', status: 'todo' },
        ],
      });

      const scaffoldedIds = new Set(Object.values(result.key_to_id));
      for (const task of await listTasks(db, project.id)) {
        if (scaffoldedIds.has(task.id)) {
          expect(task.goalId).toBe(active.id);
        }
      }

      const taskService = createTaskService({ db, orgId });
      const next = await taskService.nextActionable(project.id);
      expect(next?.reason).toBe('ok');
      expect(next?.next_task?.goal_id).toBe(active.id);
      expect(scaffoldedIds.has(next?.next_task?.id ?? '')).toBe(true);
    },
  );

  it('creates a goal and scaffolds onto it when no active goal exists', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'No active goal' });
    const complete = await createGoal(db, {
      projectId: project.id,
      objective: 'Finished',
      status: 'complete',
    });
    await backdateGoal(complete.id, 20_000);

    const result = await service.scaffoldFromPlan({
      projectId: project.id,
      tasks: [{ key: 'a', label: 'Task A', status: 'todo' }],
    });

    const task = await getTask(db, result.key_to_id.a as string);
    expect(task?.goalId).not.toBe(complete.id);

    const taskService = createTaskService({ db, orgId });
    const next = await taskService.nextActionable(project.id);
    expect(next?.reason).toBe('ok');
    expect(next?.next_task?.goal_id).toBe(task?.goalId);
    expect(next?.next_task?.id).toBe(task?.id);
  });

  it('rejects scaffold without goal_id when multiple active goals exist', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'Ambiguous' });
    const goalA = await createGoal(db, {
      projectId: project.id,
      objective: 'Cycle A',
      status: 'active',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const goalB = await createGoal(db, {
      projectId: project.id,
      objective: 'Cycle B',
      status: 'active',
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    await expect(
      service.scaffoldFromPlan({
        projectId: project.id,
        tasks: [{ key: 'a', label: 'A' }],
      }),
    ).rejects.toThrow(AmbiguousActiveGoalsError);

    const message = await service
      .scaffoldFromPlan({
        projectId: project.id,
        tasks: [{ key: 'a', label: 'A' }],
      })
      .then(() => '')
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    expect(message).toContain(goalA.id);
    expect(message).toContain(goalB.id);
    expect(await listTasks(db, project.id)).toHaveLength(0);
  });

  it('per-task goal_id overrides the call-level goal_id', async () => {
    const service = await createService();
    const project = await createProject(db, { name: 'Per-task goals' });
    const callGoal = await createGoal(db, {
      projectId: project.id,
      objective: 'Call-level',
      status: 'active',
    });
    const taskGoal = await createGoal(db, {
      projectId: project.id,
      objective: 'Task-level',
      status: 'active',
    });

    const result = await service.scaffoldFromPlan({
      projectId: project.id,
      goalId: callGoal.id,
      tasks: [
        { key: 'default', label: 'On call goal' },
        { key: 'override', label: 'On task goal', goalId: taskGoal.id },
      ],
    });

    expect((await getTask(db, result.key_to_id.default as string))?.goalId).toBe(callGoal.id);
    expect((await getTask(db, result.key_to_id.override as string))?.goalId).toBe(taskGoal.id);
  });
});
