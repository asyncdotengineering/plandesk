import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import {
  createGoal,
  getGoal,
  getOrCreateDefaultGoal,
  InvalidGoalStatusError,
  listGoals,
  updateGoal,
  updateGoalStatus,
} from './goals.js';

describe('goals repository', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
    const project = createProject(db, { name: 'Test Project' });
    projectId = project.id;
  });

  it('creates and retrieves a goal', () => {
    const created = createGoal(db, {
      projectId,
      objective: 'Ship goals',
      status: 'active',
      verificationSurface: 'tests',
    });
    const fetched = getGoal(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.objective).toBe('Ship goals');
  });

  it('lists goals for a project ordered by creation', () => {
    const first = createGoal(db, {
      projectId,
      objective: 'First',
      id: '11111111-1111-4111-8111-111111111111',
    });
    const second = createGoal(db, {
      projectId,
      objective: 'Second',
      id: '22222222-2222-4222-8222-222222222222',
    });
    expect(listGoals(db, projectId).map((goal) => goal.objective)).toEqual([
      first.objective,
      second.objective,
    ]);
  });

  it('rejects an invalid status on create', () => {
    expect(() =>
      createGoal(db, {
        projectId,
        objective: 'Bad',
        status: 'invalid' as 'active',
      }),
    ).toThrow(InvalidGoalStatusError);
  });

  it('updates a goal and bumps updated_at', () => {
    const created = createGoal(db, { projectId, objective: 'Before' });
    const updated = updateGoal(db, created.id, {
      objective: 'After',
      constraints: 'No scope creep',
    });
    expect(updated?.objective).toBe('After');
    expect(updated?.constraints).toBe('No scope creep');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('updates goal status', () => {
    const created = createGoal(db, { projectId, objective: 'Pause me' });
    const updated = updateGoalStatus(db, created.id, 'paused');
    expect(updated?.status).toBe('paused');
  });

  it('getOrCreateDefaultGoal returns earliest goal or creates General', () => {
    const first = getOrCreateDefaultGoal(db, projectId);
    expect(first.objective).toBe('General');
    expect(first.status).toBe('active');

    const second = createGoal(db, {
      projectId,
      objective: 'Earlier',
      id: '11111111-1111-4111-8111-111111111111',
    });
    db.$client
      .prepare('UPDATE goals SET created_at = ? WHERE id = ?')
      .run(Date.now() - 10_000, second.id);

    const resolved = getOrCreateDefaultGoal(db, projectId);
    expect(resolved.id).toBe(second.id);

    const again = getOrCreateDefaultGoal(db, projectId);
    expect(again.id).toBe(resolved.id);
    expect(listGoals(db, projectId)).toHaveLength(2);
  });
});
