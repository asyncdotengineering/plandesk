import { taskStatuses, type SerializedTask, type TaskStatus } from '../../lib/api.js';

export const boardColumnOrder: TaskStatus[] = ['scope', 'todo', 'in_progress', 'done', 'backlog'];

export const columnLabels: Record<TaskStatus, string> = {
  scope: 'Scope',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  backlog: 'Backlog',
};

export function groupTasksByStatus(tasks: SerializedTask[]): Record<TaskStatus, SerializedTask[]> {
  const grouped = Object.fromEntries(
    taskStatuses.map((status) => [status, [] as SerializedTask[]]),
  ) as Record<TaskStatus, SerializedTask[]>;

  for (const task of tasks) {
    grouped[task.status].push(task);
  }

  return grouped;
}

export function resolveDropStatus(
  overId: string | number | undefined,
  tasksById: Map<string, SerializedTask>,
): TaskStatus | undefined {
  if (overId === undefined) {
    return undefined;
  }
  const id = String(overId);
  if ((taskStatuses as readonly string[]).includes(id)) {
    return id as TaskStatus;
  }
  return tasksById.get(id)?.status;
}
