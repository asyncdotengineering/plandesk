import {
  createTask,
  deleteEdgesByTaskId,
  deleteTask as dbDeleteTask,
  getProject,
  getTask,
  InvalidTaskStatusError,
  isTaskStatus,
  listTasks,
  nullDocumentsLinkedTask,
  updateTask,
  type Db,
  type TaskStatus,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeTask, type PaginationParams } from '../serialize.js';

export type TaskServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CreateTaskInput = {
  label: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  dueDate?: Date | null;
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
    listByProject(
      projectId: string,
      filter: ListTasksFilter = {},
      pagination: PaginationParams = {},
    ) {
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
          ? listTasks(db, projectId, { status: statusFilter, ...pagination })
          : listTasks(db, projectId, pagination);
      return tasks.map(serializeTask);
    },

    create(projectId: string, input: CreateTaskInput) {
      if (input.status !== undefined && !isTaskStatus(input.status)) {
        throw new InvalidTaskStatusError(input.status);
      }

      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const task = createTask(db, {
        projectId,
        label: input.label,
        status: input.status,
        description: input.description,
        x: input.x,
        y: input.y,
        assignee: input.assignee,
        dueDate: input.dueDate,
      });

      eventBus.emit({
        type: 'task_updated',
        taskId: task.id,
        projectId,
      });

      return serializeTask(task);
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

    delete(id: string) {
      const task = getTask(db, id);
      if (!task) {
        return false;
      }

      const projectId = task.projectId;

      db.transaction((tx) => {
        deleteEdgesByTaskId(tx, id);
        nullDocumentsLinkedTask(tx, id);
        dbDeleteTask(tx, id);
      });

      eventBus.emit({ type: 'canvas_updated', projectId });
      return true;
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
