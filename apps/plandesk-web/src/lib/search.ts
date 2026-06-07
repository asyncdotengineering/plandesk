import { taskStatuses, type TaskStatus } from './api.js';

export type TaskFilterSearch = {
  status?: TaskStatus;
};

export function validateTaskFilterSearch(search: Record<string, unknown>): TaskFilterSearch {
  const status = search.status;
  if (typeof status === 'string' && (taskStatuses as readonly string[]).includes(status)) {
    return { status: status as TaskStatus };
  }
  return {};
}
