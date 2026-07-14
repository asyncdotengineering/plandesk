import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createGoal,
  createProjectInDefaultOrg as createProject,
  getGoal,
  InvalidGoalStatusError,
  listTasks,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import {
  createGoalService,
  evaluateEvidence,
  GoalCompletionBlockedError,
  GoalVerificationRequiredError,
  InvalidGoalTransitionError,
  InvalidVerificationSurfaceError,
  parseVerificationSurface,
} from './goals.js';

const gateSurface = JSON.stringify({ kind: 'gate_command', command: 'pnpm test' });
const checklistSurface = JSON.stringify({
  kind: 'acceptance_checklist',
  items: [{ criterion: 'Tests pass' }, { criterion: 'Lint clean' }],
});

describe('verification parsing', () => {
  it('parses gate_command surface', async () => {
    expect(parseVerificationSurface(gateSurface)).toEqual({
      kind: 'gate_command',
      command: 'pnpm test',
    });
  });

  it('rejects malformed and unknown surfaces', async () => {
    expect(() => parseVerificationSurface('not json')).toThrow(InvalidVerificationSurfaceError);
    expect(() => parseVerificationSurface(JSON.stringify({ kind: 'bogus' }))).toThrow(
      InvalidVerificationSurfaceError,
    );
    expect(() =>
      parseVerificationSurface(JSON.stringify({ kind: 'acceptance_checklist', items: [] })),
    ).toThrow(InvalidVerificationSurfaceError);
  });

  it('evaluates evidence per surface kind', async () => {
    const checklist = parseVerificationSurface(checklistSurface);
    if (!checklist) {
      throw new Error('expected checklist surface');
    }
    expect(
      evaluateEvidence(checklist, {
        kind: 'acceptance_checklist',
        checked: ['Tests pass', 'Lint clean'],
      }).green,
    ).toBe(true);
    expect(
      evaluateEvidence(checklist, { kind: 'acceptance_checklist', checked: ['Tests pass'] }).green,
    ).toBe(false);
    expect(
      evaluateEvidence({ kind: 'human_sign_off' }, { kind: 'human_sign_off', approved_by: 'alice' })
        .green,
    ).toBe(true);
    expect(
      evaluateEvidence(
        { kind: 'gate_command', command: 'pnpm test' },
        { kind: 'gate_command', exit_code: 0 },
      ).green,
    ).toBe(true);
    expect(
      evaluateEvidence(
        { kind: 'gate_command', command: 'pnpm test' },
        { kind: 'gate_command', exit_code: 1 },
      ).green,
    ).toBe(false);
  });
});

describe('goalService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
    let projectId = '';
  let orgId = '';

  function createService() {
    return createGoalService({ db, orgId });
  }

  async function markAllCycleTasksDone(goalId: string) {
    for (const task of (await listTasks(db, projectId)).filter((row) => row.goalId === goalId)) {
      await db.$client.execute({ sql: 'UPDATE tasks SET status = ? WHERE id = ?', args: ['done', task.id] });
    }
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM task_tags');
    await db.$client.execute('DELETE FROM tags');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    const project = await createProject(db, { name: 'Project' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('creates a goal', async () => {
    const service = createGoalService({ db, orgId });

    const goal = await service.create(projectId, {
      objective: 'Ship goals',
      verificationSurface: gateSurface,
      constraints: 'backend only',
    });

    expect(goal).toMatchObject({
      project_id: projectId,
      objective: 'Ship goals',
      status: 'active',
      verification_surface: gateSurface,
      constraints: 'backend only',
    });
    expect(goal).toBeDefined();
    if (!goal) {
      throw new Error('expected created goal');
    }
  });

  it('rejects invalid verification_surface on create and update', async () => {
    const service = createService();
    await expect(service.create(projectId, { objective: 'Bad', verificationSurface: 'pnpm validate' }),).rejects.toThrow(InvalidVerificationSurfaceError);

    const goal = await service.create(projectId, { objective: 'Ok' });
    await expect(service.update(goal?.id ?? '', { verificationSurface: '{not json' })).rejects.toThrow(
      InvalidVerificationSurfaceError,
    );
  });

  it('returns undefined when creating a goal for a missing project', async () => {
    const service = createService();
    expect(
      await service.create('00000000-0000-4000-8000-000000009999', { objective: 'Ghost' }),
    ).toBeUndefined();
  });

  it('rejects invalid status on create', async () => {
    const service = createService();
    await expect(service.create(projectId, { objective: 'Bad', status: 'bogus' as 'active' }),).rejects.toThrow(InvalidGoalStatusError);
  });

  it('gets a goal with cycle_tasks', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'Cycle' });
    const otherGoal = await createGoal(db, { projectId, objective: 'Other' });
    const task = await createTask(db, { projectId, goalId: goal.id, label: 'Child', status: 'todo' });
    await createTask(db, { projectId, goalId: otherGoal.id, label: 'Other goal child', status: 'todo' });

    const fetched = await service.get(goal.id);
    expect(fetched?.objective).toBe('Cycle');
    expect(fetched?.cycle_tasks).toHaveLength(1);
    expect(fetched?.cycle_tasks[0]?.id).toBe(task.id);
  });

  it('lists goals for a project', async () => {
    const service = createService();
    const first = await createGoal(db, { projectId, objective: 'First' });
    const second = await createGoal(db, { projectId, objective: 'Second' });
    await db.$client.execute({
      sql: 'UPDATE goals SET created_at = ? WHERE id = ?',
      args: [new Date('2026-01-01T00:00:00.000Z').toISOString(), first.id],
    });
    await db.$client.execute({
      sql: 'UPDATE goals SET created_at = ? WHERE id = ?',
      args: [new Date('2026-01-02T00:00:00.000Z').toISOString(), second.id],
    });

    const goals = await service.listByProject(projectId);
    expect(goals?.map((goal) => goal.objective)).toEqual(['First', 'Second']);
    expect(await service.listByProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates contract fields but not status', async () => {
    const service = createService();
    const goal = await service.create(projectId, { objective: 'Before' });
    const updated = await service.update(goal?.id ?? '', {
      objective: 'After',
      budget: '2h',
    });

    expect(updated).toMatchObject({ objective: 'After', budget: '2h', status: 'active' });
    expect((await getGoal(db, goal?.id ?? ''))?.status).toBe('active');
  });

  it('pause and resume enforce transition guards', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'Lifecycle', status: 'active' });

    const paused = await service.pause(goal.id);
    expect(paused?.status).toBe('paused');
    await expect(service.pause(goal.id)).rejects.toThrow(InvalidGoalTransitionError);

    const resumed = await service.resume(goal.id);
    expect(resumed?.status).toBe('active');
    await expect(service.resume(goal.id)).rejects.toThrow(InvalidGoalTransitionError);
  });

  it('complete blocks until all cycle-tasks are done', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'Finish line', status: 'active' });
    const open = await createTask(db, { projectId, goalId: goal.id, label: 'Open', status: 'todo' });
    const done = await createTask(db, { projectId, goalId: goal.id, label: 'Done', status: 'done' });

    await expect(service.complete(goal.id)).rejects.toThrow(GoalCompletionBlockedError);
    try {
      await service.complete(goal.id);
    } catch (error) {
      expect(error).toBeInstanceOf(GoalCompletionBlockedError);
      if (error instanceof GoalCompletionBlockedError) {
        expect(error.incompleteTaskIds).toEqual([open.id]);
      }
    }

    const otherGoal = await createGoal(db, { projectId, objective: 'Other', status: 'active' });
    await createTask(db, { projectId, goalId: otherGoal.id, label: 'Other goal open', status: 'todo' });
    await db.$client.execute({ sql: 'UPDATE tasks SET status = ? WHERE id = ?', args: ['done', open.id] });

    const completed = await service.complete(goal.id);
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: null });
    expect(done.id).toBeTruthy();
  });

  it('surfaceless goal completes with last_verification on children-done only', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'No surface', status: 'active' });
    await createTask(db, { projectId, goalId: goal.id, label: 'Only', status: 'done' });

    const completed = await service.complete(goal.id);
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: null });
    expect(completed?.last_verification?.at).toBeTruthy();
  });

  it('gate_command green completes and red blocks with one scope task', async () => {
    const service = createService();
    const goal = await createGoal(db, {
      projectId,
      objective: 'Gated',
      status: 'active',
      verificationSurface: gateSurface,
    });
    await createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    await expect(service.complete(goal.id)).rejects.toThrow(GoalVerificationRequiredError);

    const blocked = await service.complete(goal.id, { kind: 'gate_command', exit_code: 1 });
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.last_verification).toMatchObject({ green: false, kind: 'gate_command' });

    const scopeTasks = (await listTasks(db, projectId)).filter(
      (task) => task.goalId === goal.id && task.status === 'scope',
    );
    expect(scopeTasks).toHaveLength(1);
    expect(scopeTasks[0]?.description).toContain(`Acceptance-block-for: ${goal.id}`);

    const blockedAgain = await service.complete(goal.id, { kind: 'gate_command', exit_code: 1 });
    expect(blockedAgain?.status).toBe('blocked');
    expect(
      (await listTasks(db, projectId)).filter((task) => task.goalId === goal.id && task.status === 'scope'),
    ).toHaveLength(1);

    await db.$client.execute({ sql: 'UPDATE goals SET status = ? WHERE id = ?', args: ['active', goal.id] });
    await markAllCycleTasksDone(goal.id);
    for (const task of (await listTasks(db, projectId)).filter(
      (row) => row.goalId === goal.id && row.status === 'scope',
    )) {
      await db.$client.execute({ sql: 'UPDATE tasks SET status = ? WHERE id = ?', args: ['done', task.id] });
    }
    const completed = await service.complete(goal.id, { kind: 'gate_command', exit_code: 0 });
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: 'gate_command' });
  });

  it('green re-completion of a blocked goal resolves its acceptance blocker (board stays true)', async () => {
    const service = createService();
    const gateSurface = JSON.stringify({ kind: 'gate_command', command: 'pnpm validate' });
    const goal = await createGoal(db, {
      projectId,
      objective: 'Gated',
      status: 'active',
      verificationSurface: gateSurface,
    });
    await createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    const blocked = await service.complete(goal.id, { kind: 'gate_command', exit_code: 1 });
    expect(blocked?.status).toBe('blocked');
    const blocker = (await listTasks(db, projectId)).find(
      (task) =>
        task.goalId === goal.id && task.description?.includes(`Acceptance-block-for: ${goal.id}`),
    );
    expect(blocker?.status).toBe('scope');

    // Re-run with green evidence directly on the blocked goal (no manual fixups).
    const completed = await service.complete(goal.id, { kind: 'gate_command', exit_code: 0 });
    expect(completed?.status).toBe('complete');
    // The obsolete remediation task must be resolved — a completed goal shows no open work.
    const after = (await listTasks(db, projectId)).find((task) => task.id === blocker?.id);
    expect(after?.status).toBe('done');
    expect(
      (await listTasks(db, projectId)).filter((task) => task.goalId === goal.id && task.status === 'scope'),
    ).toHaveLength(0);
  });

  it('acceptance_checklist partial is red and full is green', async () => {
    const service = createService();
    const goal = await createGoal(db, {
      projectId,
      objective: 'Checklist',
      status: 'active',
      verificationSurface: checklistSurface,
    });
    await createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    const partial = await service.complete(goal.id, {
      kind: 'acceptance_checklist',
      checked: ['Tests pass'],
    });
    expect(partial?.status).toBe('blocked');

    await db.$client.execute({ sql: 'UPDATE goals SET status = ? WHERE id = ?', args: ['active', goal.id] });
    await markAllCycleTasksDone(goal.id);
    const full = await service.complete(goal.id, {
      kind: 'acceptance_checklist',
      checked: ['Tests pass', 'Lint clean'],
    });
    expect(full?.status).toBe('complete');
  });

  it('human_sign_off with approved_by completes', async () => {
    const service = createService();
    const surface = JSON.stringify({ kind: 'human_sign_off' });
    const goal = await createGoal(db, {
      projectId,
      objective: 'Sign-off',
      status: 'active',
      verificationSurface: surface,
    });
    await createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    const completed = await service.complete(goal.id, {
      kind: 'human_sign_off',
      approved_by: 'reviewer',
    });
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: 'human_sign_off' });
  });

  it('rejects mismatched evidence kind', async () => {
    const service = createService();
    const goal = await createGoal(db, {
      projectId,
      objective: 'Mismatch',
      status: 'active',
      verificationSurface: gateSurface,
    });
    await createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    await expect(service.complete(goal.id, { kind: 'human_sign_off', approved_by: 'alice' }),).rejects.toThrow(GoalVerificationRequiredError);
  });

  it('returns undefined for missing goals on lifecycle methods', async () => {
    const service = createService();
    expect(await service.pause('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(await service.resume('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(await service.complete('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });
});
