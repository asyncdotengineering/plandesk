import {
  getProject,
  getTask,
  InvalidTaskStatusError,
  isTaskStatus,
  listTasks,
  updateTask,
  type Db,
  type TaskStatus,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeTask } from '../serialize.js';

export type TaskServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type UpdateTaskInput = {
  label?: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
};

export type ListTasksFilter = {
  status?: string;
};

export function createTaskService(deps: TaskServiceDeps) {
  const { db, eventBus } = deps;

  return {
    listByProject(projectId: string, filter: ListTasksFilter = {}) {
      if (filter.status !== undefined && !isTaskStatus(filter.status)) {
        throw new InvalidTaskStatusError(filter.status);
      }

      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const statusFilter = filter.status;
      const tasks =
        statusFilter !== undefined
          ? listTasks(db, projectId, { status: statusFilter })
          : listTasks(db, projectId);
      return tasks.map(serializeTask);
    },

    update(id: string, input: UpdateTaskInput) {
      if (input.status !== undefined && !isTaskStatus(input.status)) {
        throw new InvalidTaskStatusError(input.status);
      }

      const existing = getTask(db, id);
      if (!existing) {
        return undefined;
      }

      const task = updateTask(db, id, input);
      if (!task) {
        return undefined;
      }

      eventBus.emit({
        type: 'task_updated',
        taskId: task.id,
        projectId: task.projectId,
      });

      return serializeTask(task);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
