import type { DbClient } from './client.js';
import { getOrCreateDefaultGoal } from './repositories/goals.js';
import { createTask, type NewTask, type Task } from './repositories/tasks.js';

export async function createTaskWithDefaultGoal(
  db: DbClient,
  input: Omit<NewTask, 'goalId'> & { goalId?: string },
): Promise<Task> {
  const goalId = input.goalId ?? (await getOrCreateDefaultGoal(db, input.projectId)).id;
  return createTask(db, { ...input, goalId });
}
