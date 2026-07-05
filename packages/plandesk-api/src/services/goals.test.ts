import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createGoal,
  createProject,
  getGoal,
  InvalidGoalStatusError,
  listTasks,
  migrate,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createEventBus, type GoalUpdatedEvent } from '../events.js';
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
  it('parses gate_command surface', () => {
    expect(parseVerificationSurface(gateSurface)).toEqual({
      kind: 'gate_command',
      command: 'pnpm test',
    });
  });

  it('rejects malformed and unknown surfaces', () => {
    expect(() => parseVerificationSurface('not json')).toThrow(InvalidVerificationSurfaceError);
    expect(() => parseVerificationSurface(JSON.stringify({ kind: 'bogus' }))).toThrow(
      InvalidVerificationSurfaceError,
    );
    expect(() =>
      parseVerificationSurface(JSON.stringify({ kind: 'acceptance_checklist', items: [] })),
    ).toThrow(InvalidVerificationSurfaceError);
  });

  it('evaluates evidence per surface kind', () => {
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
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createGoalService({ db, eventBus });
  }

  function markAllCycleTasksDone(goalId: string) {
    for (const task of listTasks(db, projectId).filter((row) => row.goalId === goalId)) {
      db.$client.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', task.id);
    }
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM task_tags');
    db.$client.exec('DELETE FROM tags');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Project' }).id;
  });

  it('creates a goal and emits goal_updated', () => {
    const bus = createEventBus();
    const service = createGoalService({ db, eventBus: bus });
    const received: GoalUpdatedEvent[] = [];
    bus.subscribe((event) => {
      if (event.type === 'goal_updated') {
        received.push(event);
      }
    });

    const goal = service.create(projectId, {
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
    expect(received).toEqual([{ type: 'goal_updated', goalId: goal.id, projectId }]);
  });

  it('rejects invalid verification_surface on create and update', () => {
    const service = createService();
    expect(() =>
      service.create(projectId, { objective: 'Bad', verificationSurface: 'pnpm validate' }),
    ).toThrow(InvalidVerificationSurfaceError);

    const goal = service.create(projectId, { objective: 'Ok' });
    expect(() => service.update(goal?.id ?? '', { verificationSurface: '{not json' })).toThrow(
      InvalidVerificationSurfaceError,
    );
  });

  it('returns undefined when creating a goal for a missing project', () => {
    const service = createService();
    expect(
      service.create('00000000-0000-4000-8000-000000009999', { objective: 'Ghost' }),
    ).toBeUndefined();
  });

  it('rejects invalid status on create', () => {
    const service = createService();
    expect(() =>
      service.create(projectId, { objective: 'Bad', status: 'bogus' as 'active' }),
    ).toThrow(InvalidGoalStatusError);
  });

  it('gets a goal with cycle_tasks', () => {
    const service = createService();
    const goal = createGoal(db, { projectId, objective: 'Cycle' });
    const otherGoal = createGoal(db, { projectId, objective: 'Other' });
    const task = createTask(db, { projectId, goalId: goal.id, label: 'Child', status: 'todo' });
    createTask(db, { projectId, goalId: otherGoal.id, label: 'Other goal child', status: 'todo' });

    const fetched = service.get(goal.id);
    expect(fetched?.objective).toBe('Cycle');
    expect(fetched?.cycle_tasks).toHaveLength(1);
    expect(fetched?.cycle_tasks[0]?.id).toBe(task.id);
  });

  it('lists goals for a project', () => {
    const service = createService();
    const first = createGoal(db, { projectId, objective: 'First' });
    const second = createGoal(db, { projectId, objective: 'Second' });
    db.$client
      .prepare('UPDATE goals SET created_at = ? WHERE id = ?')
      .run(new Date('2026-01-01T00:00:00.000Z').toISOString(), first.id);
    db.$client
      .prepare('UPDATE goals SET created_at = ? WHERE id = ?')
      .run(new Date('2026-01-02T00:00:00.000Z').toISOString(), second.id);

    const goals = service.listByProject(projectId);
    expect(goals?.map((goal) => goal.objective)).toEqual(['First', 'Second']);
    expect(service.listByProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates contract fields but not status', () => {
    const service = createService();
    const goal = service.create(projectId, { objective: 'Before' });
    const updated = service.update(goal?.id ?? '', {
      objective: 'After',
      budget: '2h',
    });

    expect(updated).toMatchObject({ objective: 'After', budget: '2h', status: 'active' });
    expect(getGoal(db, goal?.id ?? '')?.status).toBe('active');
  });

  it('pause and resume enforce transition guards', () => {
    const service = createService();
    const goal = createGoal(db, { projectId, objective: 'Lifecycle', status: 'active' });

    const paused = service.pause(goal.id);
    expect(paused?.status).toBe('paused');
    expect(() => service.pause(goal.id)).toThrow(InvalidGoalTransitionError);

    const resumed = service.resume(goal.id);
    expect(resumed?.status).toBe('active');
    expect(() => service.resume(goal.id)).toThrow(InvalidGoalTransitionError);
  });

  it('complete blocks until all cycle-tasks are done', () => {
    const service = createService();
    const goal = createGoal(db, { projectId, objective: 'Finish line', status: 'active' });
    const open = createTask(db, { projectId, goalId: goal.id, label: 'Open', status: 'todo' });
    const done = createTask(db, { projectId, goalId: goal.id, label: 'Done', status: 'done' });

    expect(() => service.complete(goal.id)).toThrow(GoalCompletionBlockedError);
    try {
      service.complete(goal.id);
    } catch (error) {
      expect(error).toBeInstanceOf(GoalCompletionBlockedError);
      if (error instanceof GoalCompletionBlockedError) {
        expect(error.incompleteTaskIds).toEqual([open.id]);
      }
    }

    const otherGoal = createGoal(db, { projectId, objective: 'Other', status: 'active' });
    createTask(db, { projectId, goalId: otherGoal.id, label: 'Other goal open', status: 'todo' });
    db.$client.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', open.id);

    const completed = service.complete(goal.id);
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: null });
    expect(done.id).toBeTruthy();
  });

  it('surfaceless goal completes with last_verification on children-done only', () => {
    const service = createService();
    const goal = createGoal(db, { projectId, objective: 'No surface', status: 'active' });
    createTask(db, { projectId, goalId: goal.id, label: 'Only', status: 'done' });

    const completed = service.complete(goal.id);
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: null });
    expect(completed?.last_verification?.at).toBeTruthy();
  });

  it('gate_command green completes and red blocks with one scope task', () => {
    const service = createService();
    const goal = createGoal(db, {
      projectId,
      objective: 'Gated',
      status: 'active',
      verificationSurface: gateSurface,
    });
    createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    expect(() => service.complete(goal.id)).toThrow(GoalVerificationRequiredError);

    const blocked = service.complete(goal.id, { kind: 'gate_command', exit_code: 1 });
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.last_verification).toMatchObject({ green: false, kind: 'gate_command' });

    const scopeTasks = listTasks(db, projectId).filter(
      (task) => task.goalId === goal.id && task.status === 'scope',
    );
    expect(scopeTasks).toHaveLength(1);
    expect(scopeTasks[0]?.description).toContain(`Acceptance-block-for: ${goal.id}`);

    const blockedAgain = service.complete(goal.id, { kind: 'gate_command', exit_code: 1 });
    expect(blockedAgain?.status).toBe('blocked');
    expect(
      listTasks(db, projectId).filter((task) => task.goalId === goal.id && task.status === 'scope'),
    ).toHaveLength(1);

    db.$client.prepare('UPDATE goals SET status = ? WHERE id = ?').run('active', goal.id);
    markAllCycleTasksDone(goal.id);
    for (const task of listTasks(db, projectId).filter(
      (row) => row.goalId === goal.id && row.status === 'scope',
    )) {
      db.$client.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', task.id);
    }
    const completed = service.complete(goal.id, { kind: 'gate_command', exit_code: 0 });
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: 'gate_command' });
  });

  it('green re-completion of a blocked goal resolves its acceptance blocker (board stays true)', () => {
    const service = createService();
    const gateSurface = JSON.stringify({ kind: 'gate_command', command: 'pnpm validate' });
    const goal = createGoal(db, {
      projectId,
      objective: 'Gated',
      status: 'active',
      verificationSurface: gateSurface,
    });
    createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    const blocked = service.complete(goal.id, { kind: 'gate_command', exit_code: 1 });
    expect(blocked?.status).toBe('blocked');
    const blocker = listTasks(db, projectId).find(
      (task) =>
        task.goalId === goal.id && task.description?.includes(`Acceptance-block-for: ${goal.id}`),
    );
    expect(blocker?.status).toBe('scope');

    // Re-run with green evidence directly on the blocked goal (no manual fixups).
    const completed = service.complete(goal.id, { kind: 'gate_command', exit_code: 0 });
    expect(completed?.status).toBe('complete');
    // The obsolete remediation task must be resolved — a completed goal shows no open work.
    const after = listTasks(db, projectId).find((task) => task.id === blocker?.id);
    expect(after?.status).toBe('done');
    expect(
      listTasks(db, projectId).filter((task) => task.goalId === goal.id && task.status === 'scope'),
    ).toHaveLength(0);
  });

  it('acceptance_checklist partial is red and full is green', () => {
    const service = createService();
    const goal = createGoal(db, {
      projectId,
      objective: 'Checklist',
      status: 'active',
      verificationSurface: checklistSurface,
    });
    createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    const partial = service.complete(goal.id, {
      kind: 'acceptance_checklist',
      checked: ['Tests pass'],
    });
    expect(partial?.status).toBe('blocked');

    db.$client.prepare('UPDATE goals SET status = ? WHERE id = ?').run('active', goal.id);
    markAllCycleTasksDone(goal.id);
    const full = service.complete(goal.id, {
      kind: 'acceptance_checklist',
      checked: ['Tests pass', 'Lint clean'],
    });
    expect(full?.status).toBe('complete');
  });

  it('human_sign_off with approved_by completes', () => {
    const service = createService();
    const surface = JSON.stringify({ kind: 'human_sign_off' });
    const goal = createGoal(db, {
      projectId,
      objective: 'Sign-off',
      status: 'active',
      verificationSurface: surface,
    });
    createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    const completed = service.complete(goal.id, {
      kind: 'human_sign_off',
      approved_by: 'reviewer',
    });
    expect(completed?.status).toBe('complete');
    expect(completed?.last_verification).toMatchObject({ green: true, kind: 'human_sign_off' });
  });

  it('rejects mismatched evidence kind', () => {
    const service = createService();
    const goal = createGoal(db, {
      projectId,
      objective: 'Mismatch',
      status: 'active',
      verificationSurface: gateSurface,
    });
    createTask(db, { projectId, goalId: goal.id, label: 'Done child', status: 'done' });

    expect(() =>
      service.complete(goal.id, { kind: 'human_sign_off', approved_by: 'alice' }),
    ).toThrow(GoalVerificationRequiredError);
  });

  it('returns undefined for missing goals on lifecycle methods', () => {
    const service = createService();
    expect(service.pause('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(service.resume('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(service.complete('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });
});
