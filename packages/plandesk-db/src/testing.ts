import type { DbClient } from './client.js';
import { getOrCreateDefaultGoal } from './repositories/goals.js';
import { createTask, type NewTask, type Task } from './repositories/tasks.js';

export function createTaskWithDefaultGoal(
  db: DbClient,
  input: Omit<NewTask, 'goalId'> & { goalId?: string },
): Task {
  const goalId = input.goalId ?? getOrCreateDefaultGoal(db, input.projectId).id;
  return createTask(db, { ...input, goalId });
}