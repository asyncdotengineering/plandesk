import {
  taskStatuses,
  type SerializedTag,
  type SerializedTask,
  type TaskStatus,
} from '../../lib/api.js';

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

export const LANE_TAG_PREFIX = 'lane:';

// Lane/severity is intentionally NOT a task field. It is carried as a
// `lane:<value>` tag when present and surfaced separately from tag chips.
export function laneFromTags(tags: SerializedTag[] | undefined): string | undefined {
  for (const tag of tags ?? []) {
    if (tag.name.startsWith(LANE_TAG_PREFIX)) {
      return tag.name.slice(LANE_TAG_PREFIX.length);
    }
  }
  return undefined;
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
