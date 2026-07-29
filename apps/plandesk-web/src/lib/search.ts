import { taskStatuses, type TaskStatus } from './api.js';

export type TaskFilterSearch = {
  status?: TaskStatus;
  /**
   * Task to open in the drawer. Makes a task addressable: without it the drawer
   * is component state only, so nothing elsewhere in the app — a document's
   * links, a share link, a pasted URL — can point at a specific task.
   */
  task?: string;
};

export function validateTaskFilterSearch(search: Record<string, unknown>): TaskFilterSearch {
  const result: TaskFilterSearch = {};

  const status = search.status;
  if (typeof status === 'string' && (taskStatuses as readonly string[]).includes(status)) {
    result.status = status as TaskStatus;
  }

  const task = search.task;
  if (typeof task === 'string' && task !== '') {
    result.task = task;
  }

  return result;
}
