import {
  withTransaction,
  createTag,
  createTask,
  deleteCommentsByTarget,
  deleteEdgesByTaskId,
  deleteTask as dbDeleteTask,
  deleteTaskTagsByTaskId,
  getOrCreateDefaultGoal,
  getProject,
  listGoals,
  getTagByName,
  getTask,
  InvalidTaskStatusError,
  isTaskStatus,
  listEdges,
  listTagsByTaskForProject,
  listTagsForTask,
  listTasks,
  nullDocumentsLinkedTask,
  setTaskTags,
  taskIdsWithAnyTagName,
  updateTask,
  type Db,
  type DbClient,
  type Edge,
  type Task,
  type TaskStatus,
} from '@plandesk/db';
import { serializeTask, type PaginationParams } from '../serialize.js';
import { normalizeTagName } from './tags.js';

type SerializedTask = ReturnType<typeof serializeTask>;

export class InvalidGoalReferenceError extends Error {
  constructor(goalId: string) {
    super(`Goal ${goalId} does not exist in this project`);
    this.name = 'InvalidGoalReferenceError';
  }
}

export type NextActionableReason =
  | 'ok'
  | 'no_tasks'
  | 'no_todo_tasks'
  | 'all_blocked'
  | 'no_active_goal'
  | 'multiple_active_goals';

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
};

export type CreateTaskInput = {
  label: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  dueDate?: Date | null;
  goalId?: string;
  // Sets the task's tags by name; names without an existing tag are auto-created.
  tags?: string[];
};

export type UpdateTaskInput = {
  label?: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
  // Replaces the task's FULL tag set by name; names without an existing tag are
  // auto-created. Pass [] to clear all tags. Omit to leave tags unchanged.
  tags?: string[];
};

export type ListTasksFilter = {
  status?: string;
  // OR semantics: keep tasks carrying ANY of the given tag names.
  tags?: string[];
};

// Resolves tag names to ids, auto-creating tags that do not exist yet.
async function resolveTagIdsByName(
  db: DbClient,
  projectId: string,
  names: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const existing = await getTagByName(db, projectId, name);
    const tag = existing ?? (await createTag(db, { projectId, name }));
    ids.push(tag.id);
  }
  return ids;
}

export function createTaskService(deps: TaskServiceDeps) {
  const { db } = deps;

  return {
    async get(id: string) {
      const task = await getTask(db, id);
      if (!task) {
        return undefined;
      }
      return serializeTask(task, await listTagsForTask(db, id));
    },

    async listByProject(
      projectId: string,
      filter: ListTasksFilter = {},
      pagination: PaginationParams = {},
    ) {
      if (filter.status !== undefined && !isTaskStatus(filter.status)) {
        throw new InvalidTaskStatusError(filter.status);
      }

      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const statusFilter = filter.status;
      const tasks = await listTasks(db, projectId, {
        ...(statusFilter !== undefined ? { status: statusFilter } : {}),
        ...(filter.tags !== undefined ? { tagNames: filter.tags.map(normalizeTagName) } : {}),
        ...pagination,
      });
      const tagsByTask = await listTagsByTaskForProject(db, projectId);
      return tasks.map((task) => serializeTask(task, tagsByTask.get(task.id) ?? []));
    },

    async create(projectId: string, input: CreateTaskInput) {
      if (input.status !== undefined && !isTaskStatus(input.status)) {
        throw new InvalidTaskStatusError(input.status);
      }

      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      if (
        input.goalId !== undefined &&
        !(await listGoals(db, projectId)).some((g) => g.id === input.goalId)
      ) {
        throw new InvalidGoalReferenceError(input.goalId);
      }

      const { task, tags } = await withTransaction(db, async (tx) => {
        const goalId = input.goalId ?? (await getOrCreateDefaultGoal(tx, projectId)).id;
        const row = await createTask(tx, {
          projectId,
          goalId,
          label: input.label,
          status: input.status,
          description: input.description,
          x: input.x,
          y: input.y,
          assignee: input.assignee,
          dueDate: input.dueDate,
        });
        if (input.tags !== undefined) {
          await setTaskTags(tx, row.id, await resolveTagIdsByName(tx, projectId, input.tags));
        }
        return { task: row, tags: await listTagsForTask(tx, row.id) };
      });

      return serializeTask(task, tags);
    },

    async update(id: string, input: UpdateTaskInput) {
      if (input.status !== undefined && !isTaskStatus(input.status)) {
        throw new InvalidTaskStatusError(input.status);
      }

      const existing = await getTask(db, id);
      if (!existing) {
        return undefined;
      }

      const { tags: tagNames, ...columns } = input;
      const result = await withTransaction(db, async (tx) => {
        const row = await updateTask(tx, id, columns);
        if (!row) {
          return undefined;
        }
        if (tagNames !== undefined) {
          await setTaskTags(tx, id, await resolveTagIdsByName(tx, existing.projectId, tagNames));
        }
        return { task: row, tags: await listTagsForTask(tx, id) };
      });
      if (!result) {
        return undefined;
      }

      return serializeTask(result.task, result.tags);
    },

    async delete(id: string) {
      const task = await getTask(db, id);
      if (!task) {
        return false;
      }

      const projectId = task.projectId;

      await withTransaction(db, async (tx) => {
        await deleteCommentsByTarget(tx, 'task', id);
        await deleteEdgesByTaskId(tx, id);
        await nullDocumentsLinkedTask(tx, id);
        await deleteTaskTagsByTaskId(tx, id);
        await dbDeleteTask(tx, id);
      });

      return true;
    },

    // filter.goalId scopes candidates to one goal; when omitted, the project's sole
    // active goal is resolved. filter.tags (OR semantics) composes with goal scope;
    // prerequisite completion is still evaluated against all tasks in the project.
    async nextActionable(
      projectId: string,
      filter: { goalId?: string; tags?: string[] } = {},
    ): Promise<NextActionableResult | undefined> {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      let goalId = filter.goalId;
      if (goalId === undefined) {
        const active = (await listGoals(db, projectId)).filter((goal) => goal.status === 'active');
        if (active.length === 0) {
          return { next_task: null, reason: 'no_active_goal', blocked: [] };
        }
        if (active.length > 1) {
          return { next_task: null, reason: 'multiple_active_goals', blocked: [] };
        }
        goalId = active[0]?.id;
      } else if (!(await listGoals(db, projectId)).some((goal) => goal.id === goalId)) {
        return undefined;
      }

      const tasks = (await listTasks(db, projectId)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const edges = await listEdges(db, projectId);
      const taskById = new Map<string, Task>(tasks.map((task) => [task.id, task]));
      const tagsByTask = await listTagsByTaskForProject(db, projectId);
      const tagMatches =
        filter.tags !== undefined && filter.tags.length > 0
          ? await taskIdsWithAnyTagName(db, projectId, filter.tags.map(normalizeTagName))
          : undefined;
      const serialize = (task: Task) => serializeTask(task, tagsByTask.get(task.id) ?? []);

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

      const todoTasks = tasks.filter(
        (task) =>
          task.goalId === goalId &&
          task.status === 'todo' &&
          (tagMatches === undefined || tagMatches.has(task.id)),
      );
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
          .map(serialize);
      };

      const blocked: NextActionableResult['blocked'] = [];
      let nextTask: SerializedTask | null = null;

      for (const task of todoTasks) {
        if (isActionable(task.id)) {
          if (nextTask === null) {
            nextTask = serialize(task);
          }
        } else {
          blocked.push({
            task: serialize(task),
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
