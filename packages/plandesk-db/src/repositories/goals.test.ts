import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
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
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Test Project' });
    projectId = project.id;
  });

  it('creates and retrieves a goal', async () => {
    const created = await createGoal(db, {
      projectId,
      objective: 'Ship goals',
      status: 'active',
      verificationSurface: 'tests',
    });
    const fetched = await getGoal(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.objective).toBe('Ship goals');
  });

  it('lists goals for a project ordered by creation', async () => {
    const first = await createGoal(db, {
      projectId,
      objective: 'First',
      id: '11111111-1111-4111-8111-111111111111',
    });
    const second = await createGoal(db, {
      projectId,
      objective: 'Second',
      id: '22222222-2222-4222-8222-222222222222',
    });
    expect((await listGoals(db, projectId)).map((goal) => goal.objective)).toEqual([
      first.objective,
      second.objective,
    ]);
  });

  it('rejects an invalid status on create', async () => {
    await expect(
      createGoal(db, {
        projectId,
        objective: 'Bad',
        status: 'invalid' as 'active',
      }),
    ).rejects.toThrow(InvalidGoalStatusError);
  });

  it('updates a goal and bumps updated_at', async () => {
    const created = await createGoal(db, { projectId, objective: 'Before' });
    const updated = await updateGoal(db, created.id, {
      objective: 'After',
      constraints: 'No scope creep',
    });
    expect(updated?.objective).toBe('After');
    expect(updated?.constraints).toBe('No scope creep');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('updates goal status', async () => {
    const created = await createGoal(db, { projectId, objective: 'Pause me' });
    const updated = await updateGoalStatus(db, created.id, 'paused');
    expect(updated?.status).toBe('paused');
  });

  it('getOrCreateDefaultGoal returns earliest goal or creates General', async () => {
    const first = await getOrCreateDefaultGoal(db, projectId);
    expect(first.objective).toBe('General');
    expect(first.status).toBe('active');

    const second = await createGoal(db, {
      projectId,
      objective: 'Earlier',
      id: '11111111-1111-4111-8111-111111111111',
    });
    await db.$client.execute({
      sql: 'UPDATE goals SET created_at = ? WHERE id = ?',
      args: [Date.now() - 10_000, second.id],
    });

    const resolved = await getOrCreateDefaultGoal(db, projectId);
    expect(resolved.id).toBe(second.id);

    const again = await getOrCreateDefaultGoal(db, projectId);
    expect(again.id).toBe(resolved.id);
    expect(await listGoals(db, projectId)).toHaveLength(2);
  });
});
