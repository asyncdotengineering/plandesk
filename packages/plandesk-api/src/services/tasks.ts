import {
  createTask,
  deleteEdgesByTaskId,
  deleteTask as dbDeleteTask,
  getProject,
  getTask,
  InvalidTaskStatusError,
  isTaskStatus,
  listEdges,
  listTasks,
  nullDocumentsLinkedTask,
  updateTask,
  type Db,
  type Edge,
  type Task,
  type TaskStatus,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeTask, type PaginationParams } from '../serialize.js';

type SerializedTask = ReturnType<typeof serializeTask>;

export type NextActionableReason = 'ok' | 'no_tasks' | 'no_todo_tasks' | 'all_blocked';

export type NextActionableResult = {
  next_task: SerializedTask | null;
  reason: NextActionableReason;
  blocked: Array<{ task: SerializedTask; waiting_on: SerializedTask[] }>;
};

// depends_on: prerequisite = to, dependent = from. All other labels: prerequisite = from, dependent = to.
function prerequisiteAndDependent(
  edge: Edge,
): { prerequisite: string; dependent: string } | undefined {
  if (edge.fromTaskId === edge.toTaskId) {
    return undefined;
  }
  if (edge.label === 'depends_on') {
    return { prerequisite: edge.toTaskId, dependent: edge.fromTaskId };
  }
  return { prerequisite: edge.fromTaskId, dependent: edge.toTaskId };
}

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

    nextActionable(projectId: string): NextActionableResult | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const tasks = listTasks(db, projectId).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const edges = listEdges(db, projectId);
      const taskById = new Map<string, Task>(tasks.map((task) => [task.id, task]));

      const prerequisites = new Map<string, Set<string>>();
      for (const edge of edges) {
        const pair = prerequisiteAndDependent(edge);
        if (!pair) {
          continue;
        }
        let set = prerequisites.get(pair.dependent);
        if (!set) {
          set = new Set();
          prerequisites.set(pair.dependent, set);
        }
        set.add(pair.prerequisite);
      }

      if (tasks.length === 0) {
        return { next_task: null, reason: 'no_tasks', blocked: [] };
      }

      const todoTasks = tasks.filter((task) => task.status === 'todo');
      if (todoTasks.length === 0) {
        return { next_task: null, reason: 'no_todo_tasks', blocked: [] };
      }

      const isActionable = (taskId: string): boolean => {
        const prereqs = prerequisites.get(taskId);
        if (!prereqs || prereqs.size === 0) {
          return true;
        }
        for (const prereqId of prereqs) {
          const prereq = taskById.get(prereqId);
          if (!prereq || prereq.status !== 'done') {
            return false;
          }
        }
        return true;
      };

      const unfinishedPrereqs = (taskId: string): SerializedTask[] => {
        const prereqs = prerequisites.get(taskId);
        if (!prereqs) {
          return [];
        }
        return [...prereqs]
          .map((id) => taskById.get(id))
          .filter((task): task is Task => task !== undefined && task.status !== 'done')
          .map(serializeTask);
      };

      const blocked: NextActionableResult['blocked'] = [];
      let nextTask: SerializedTask | null = null;

      for (const task of todoTasks) {
        if (isActionable(task.id)) {
          if (nextTask === null) {
            nextTask = serializeTask(task);
          }
        } else {
          blocked.push({
            task: serializeTask(task),
            waiting_on: unfinishedPrereqs(task.id),
          });
        }
      }

      if (nextTask === null) {
        return { next_task: null, reason: 'all_blocked', blocked };
      }

      return { next_task: nextTask, reason: 'ok', blocked };
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
