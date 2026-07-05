import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createGoal,
  createProject,
  getGoal,
  InvalidGoalStatusError,
  migrate,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createEventBus, type GoalUpdatedEvent } from '../events.js';
import {
  createGoalService,
  GoalCompletionBlockedError,
  InvalidGoalTransitionError,
} from './goals.js';

describe('goalService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createGoalService({ db, eventBus });
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
      verificationSurface: 'pnpm validate',
      constraints: 'backend only',
    });

    expect(goal).toMatchObject({
      project_id: projectId,
      objective: 'Ship goals',
      status: 'active',
      verification_surface: 'pnpm validate',
      constraints: 'backend only',
    });
    expect(goal).toBeDefined();
    if (!goal) {
      throw new Error('expected created goal');
    }
    expect(received).toEqual([{ type: 'goal_updated', goalId: goal.id, projectId }]);
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
    expect(done.id).toBeTruthy();
  });

  it('returns undefined for missing goals on lifecycle methods', () => {
    const service = createService();
    expect(service.pause('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(service.resume('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(service.complete('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });
});
