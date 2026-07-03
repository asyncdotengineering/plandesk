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

// Multi-tag filter uses OR semantics: a task matches when it carries ANY of
// the selected tags. An empty selection shows every task.
export function filterTasksByAnyTag(
  tasks: SerializedTask[],
  selectedTagIds: string[],
): SerializedTask[] {
  if (selectedTagIds.length === 0) {
    return tasks;
  }
  const selected = new Set(selectedTagIds);
  return tasks.filter((task) => (task.tags ?? []).some((tag) => selected.has(tag.id)));
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
