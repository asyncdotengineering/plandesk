import type { Db } from './client.js';
import { assertTableStoresColumns } from './schema-columns.js';
import type { TaskUpdate } from './repositories/tasks.js';

export const TASK_INSERT_COLUMNS = [
  'id',
  'project_id',
  'goal_id',
  'label',
  'status',
  'kind',
  'priority',
  'lane',
  'severity',
  'description',
  'x',
  'y',
  'assignee',
  'due_date',
  'created_at',
  'updated_at',
] as const;

const TASK_UPDATE_COLUMN_BY_KEY: Record<keyof TaskUpdate, string> = {
  label: 'label',
  status: 'status',
  kind: 'kind',
  priority: 'priority',
  lane: 'lane',
  severity: 'severity',
  description: 'description',
  x: 'x',
  y: 'y',
  assignee: 'assignee',
  dueDate: 'due_date',
  goalId: 'goal_id',
  commitRefs: 'commit_refs',
};

export function taskUpdateColumns(input: TaskUpdate): string[] {
  return (Object.keys(input) as (keyof TaskUpdate)[]).map((key) => TASK_UPDATE_COLUMN_BY_KEY[key]);
}

export async function assertTaskCreateSchema(db: Db): Promise<void> {
  await assertTableStoresColumns(db, 'tasks', [...TASK_INSERT_COLUMNS]);
}

export async function assertTaskUpdateSchema(db: Db, input: TaskUpdate): Promise<void> {
  const columns = taskUpdateColumns(input);
  if (columns.length > 0) {
    await assertTableStoresColumns(db, 'tasks', columns);
  }
}
