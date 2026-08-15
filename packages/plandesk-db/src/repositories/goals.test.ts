import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import {
  createGoal,
  getGoal,
  getOrCreateDefaultGoal,
  AmbiguousActiveGoalsError,
  InvalidGoalStatusError,
  listGoals,
  resolveGoalForNewWork,
  updateGoal,
  updateGoalStatus,
} from './goals.js';
import { setProjectCurrentGoalId } from './projects.js';

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

  it('round-trips nullable names and enforces uniqueness within a project', async () => {
    const named = await createGoal(db, { projectId, name: 'ship-auth', objective: 'Ship auth' });
    expect(named.name).toBe('ship-auth');
    expect((await getGoal(db, named.id))?.name).toBe('ship-auth');
    const unnamed = await createGoal(db, { projectId, objective: 'No handle' });
    expect(unnamed.name).toBeNull();
    await expect(
      createGoal(db, { projectId, name: 'ship-auth', objective: 'Duplicate' }),
    ).rejects.toThrow();
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

  it('resolveGoalForNewWork returns the sole active goal or creates General', async () => {
    const created = await resolveGoalForNewWork(db, projectId);
    expect(created.objective).toBe('General');
    expect(created.status).toBe('active');

    const again = await resolveGoalForNewWork(db, projectId);
    expect(again.id).toBe(created.id);
    expect(await listGoals(db, projectId)).toHaveLength(1);
  });

  it('resolveGoalForNewWork picks the earliest active goal and ignores inactive ones', async () => {
    const complete = await createGoal(db, {
      projectId,
      objective: 'Done cycle',
      status: 'complete',
      id: '11111111-1111-4111-8111-111111111111',
    });
    await db.$client.execute({
      sql: 'UPDATE goals SET created_at = ? WHERE id = ?',
      args: [Date.now() - 20_000, complete.id],
    });

    const active = await createGoal(db, {
      projectId,
      objective: 'Current cycle',
      status: 'active',
      id: '22222222-2222-4222-8222-222222222222',
    });

    const resolved = await resolveGoalForNewWork(db, projectId);
    expect(resolved.id).toBe(active.id);
  });

  it('resolveGoalForNewWork throws when several are active and none is current', async () => {
    const first = await createGoal(db, {
      projectId,
      objective: 'First active',
      id: '11111111-1111-4111-8111-111111111111',
    });
    const second = await createGoal(db, {
      projectId,
      objective: 'Second active',
      id: '22222222-2222-4222-8222-222222222222',
    });
    await setProjectCurrentGoalId(db, projectId, null);

    await expect(resolveGoalForNewWork(db, projectId)).rejects.toThrow(AmbiguousActiveGoalsError);
    await expect(resolveGoalForNewWork(db, projectId)).rejects.toThrow(first.id);
    await expect(resolveGoalForNewWork(db, projectId)).rejects.toThrow(second.id);
  });

  it('resolveGoalForNewWork honours the project current goal when several are active', async () => {
    await createGoal(db, {
      projectId,
      objective: 'First active',
      id: '11111111-1111-4111-8111-111111111111',
    });
    const current = await createGoal(db, {
      projectId,
      objective: 'Second active',
      id: '22222222-2222-4222-8222-222222222222',
    });
    await setProjectCurrentGoalId(db, projectId, current.id);

    const resolved = await resolveGoalForNewWork(db, projectId);
    expect(resolved.id).toBe(current.id);
  });

  it('resolveGoalForNewWork ignores a current goal that is no longer active', async () => {
    const paused = await createGoal(db, {
      projectId,
      objective: 'Paused cycle',
      status: 'paused',
      id: '11111111-1111-4111-8111-111111111111',
    });
    const active = await createGoal(db, {
      projectId,
      objective: 'Live cycle',
      status: 'active',
      id: '22222222-2222-4222-8222-222222222222',
    });
    await setProjectCurrentGoalId(db, projectId, paused.id);

    const resolved = await resolveGoalForNewWork(db, projectId);
    expect(resolved.id).toBe(active.id);
  });
});
