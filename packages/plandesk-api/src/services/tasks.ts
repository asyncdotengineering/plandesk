import {
  withTransaction,
  claimTask,
  createTag,
  createTask,
  deleteCommentsByTarget,
  deleteEdgesByTaskId,
  deleteTask as dbDeleteTask,
  deleteTaskTagsByTaskId,
  getOrCreateDefaultGoal,
  listGoals,
  getTagByName,
  getTask,
  InvalidTaskStatusError,
  isTaskStatus,
  isTaskKind,
  InvalidTaskKindError,
  listEdges,
  listTagsByTaskForProject,
  listTagsForTask,
  listTasks,
  listTaskStatusesByIds,
  setTaskTags,
  taskIdsWithAnyTagName,
  updateTask,
  isValidCommitRefs,
  normalizeCommitRefs,
  type Db,
  type DbClient,
  type Edge,
  type Task,
  type TaskKind,
  type TaskStatus,
} from '@plandesk/db';
import { serializeTask, type PaginationParams } from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
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
  | 'no_active_goal';

export type NextActionableResult = {
  next_task: SerializedTask | null;
  reason: NextActionableReason;
  blocked: Array<{ task: SerializedTask; waiting_on: SerializedTask[] }>;
};

export type ClaimTaskResult =
  | { claimed: true; task: SerializedTask }
  | { claimed: false; reason: 'taken_or_not_actionable' };

// depends_on: prerequisite = to, dependent = from. All other labels: prerequisite = from, dependent = to.
// Only task→task edges participate in sequencing. Polymorphic / scaffold rows are ignored.
function prerequisiteAndDependent(
  edge: Edge,
): { prerequisite: string; dependent: string } | undefined {
  if (edge.fromType !== 'task' || edge.toType !== 'task') {
    return undefined;
  }
  // A self-edge sequences nothing.
  if (edge.fromId === edge.toId) {
    return undefined;
  }
  if (edge.label === 'depends_on') {
    return { prerequisite: edge.toId, dependent: edge.fromId };
  }
  return { prerequisite: edge.fromId, dependent: edge.toId };
}

export function buildPrerequisiteMap(edges: Edge[]): Map<string, Set<string>> {
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
  return prerequisites;
}

export function unfinishedPrerequisiteIds(
  taskId: string,
  prerequisites: Map<string, Set<string>>,
  statusById: Map<string, TaskStatus>,
): string[] {
  const prereqs = prerequisites.get(taskId);
  if (!prereqs || prereqs.size === 0) {
    return [];
  }
  const unfinished: string[] = [];
  for (const prereqId of prereqs) {
    const status = statusById.get(prereqId);
    // Absent from the map = dangling edge; still unfinished.
    if (status === undefined || status !== 'done') {
      unfinished.push(prereqId);
    }
  }
  return unfinished;
}

export type TaskServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreateTaskInput = {
  label: string;
  status?: TaskStatus;
  kind?: TaskKind;
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
  kind?: TaskKind;
  description?: string | null;
  x?: number;
  y?: number;
  goalId?: string;
  // Replaces the task's FULL tag set by name; names without an existing tag are
  // auto-created. Pass [] to clear all tags. Omit to leave tags unchanged.
  tags?: string[];
  // Replaces the FULL commit_refs array. Pass null to clear; omit to leave unchanged.
  commitRefs?: string[] | null;
};

export class InvalidCommitRefsError extends Error {
  constructor() {
    super('Invalid commit_refs');
    this.name = 'InvalidCommitRefsError';
  }
}

export type ListTasksFilter = {
  status?: string;
  kind?: string;
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
      try {
        await assertProjectInOrg(db, task.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
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
      if (filter.kind !== undefined && !isTaskKind(filter.kind)) {
        throw new InvalidTaskKindError(filter.kind);
      }

      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const statusFilter = filter.status;
      const kindFilter = filter.kind;
      const tasks = await listTasks(db, projectId, {
        ...(statusFilter !== undefined ? { status: statusFilter } : {}),
        ...(kindFilter !== undefined ? { kind: kindFilter } : {}),
        ...(filter.tags !== undefined ? { tagNames: filter.tags.map(normalizeTagName) } : {}),
        ...pagination,
      });
      const edges = await listEdges(db, projectId);
      const prereqs = buildPrerequisiteMap(edges);
      const needed = new Set<string>();
      for (const task of tasks) {
        for (const id of prereqs.get(task.id) ?? []) {
          needed.add(id);
        }
      }
      const statusById = new Map(
        (await listTaskStatusesByIds(db, projectId, [...needed])).map((row) => [row.id, row.status]),
      );
      const tagsByTask = await listTagsByTaskForProject(db, projectId);
      return tasks.map((task) =>
        serializeTask(
          task,
          tagsByTask.get(task.id) ?? [],
          unfinishedPrerequisiteIds(task.id, prereqs, statusById),
        ),
      );
    },

    async create(projectId: string, input: CreateTaskInput) {
      assertPermission(deps, 'task', 'create');
      if (input.status !== undefined && !isTaskStatus(input.status)) {
        throw new InvalidTaskStatusError(input.status);
      }
      if (input.kind !== undefined && !isTaskKind(input.kind)) {
        throw new InvalidTaskKindError(input.kind);
      }

      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
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
          kind: input.kind,
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
      assertPermission(deps, 'task', 'update');
      if (input.status !== undefined && !isTaskStatus(input.status)) {
        throw new InvalidTaskStatusError(input.status);
      }
      if (input.kind !== undefined && !isTaskKind(input.kind)) {
        throw new InvalidTaskKindError(input.kind);
      }

      const existing = await getTask(db, id);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (
        input.goalId !== undefined &&
        !(await listGoals(db, existing.projectId)).some((g) => g.id === input.goalId)
      ) {
        throw new InvalidGoalReferenceError(input.goalId);
      }

      if (input.commitRefs !== undefined && input.commitRefs !== null) {
        if (!isValidCommitRefs(input.commitRefs)) {
          throw new InvalidCommitRefsError();
        }
      }

      const { tags: tagNames, commitRefs, ...columns } = input;
      const normalizedCommitRefs =
        commitRefs === undefined
          ? undefined
          : commitRefs === null
            ? null
            : normalizeCommitRefs(commitRefs);
      const result = await withTransaction(db, async (tx) => {
        const row = await updateTask(tx, id, {
          ...columns,
          ...(normalizedCommitRefs !== undefined
            ? {
                commitRefs:
                  normalizedCommitRefs === null ? null : JSON.stringify(normalizedCommitRefs),
              }
            : {}),
        });
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
      assertPermission(deps, 'task', 'delete');
      const task = await getTask(db, id);
      if (!task) {
        return false;
      }
      try {
        await assertProjectInOrg(db, task.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      await withTransaction(db, async (tx) => {
        await deleteCommentsByTarget(tx, 'task', id);
        await deleteEdgesByTaskId(tx, id);
        await deleteTaskTagsByTaskId(tx, id);
        await dbDeleteTask(tx, id);
      });

      return true;
    },

    async claim(taskId: string, agentRef: string): Promise<ClaimTaskResult | undefined> {
      assertPermission(deps, 'task', 'update');
      const existing = await getTask(db, taskId);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      const row = await claimTask(db, taskId, resolveOrgId(deps), agentRef);
      if (!row) {
        return { claimed: false, reason: 'taken_or_not_actionable' };
      }
      return {
        claimed: true,
        task: serializeTask(row, await listTagsForTask(db, row.id)),
      };
    },

    // filter.goalId scopes candidates to one goal; when omitted, the project's sole
    // active goal is resolved. filter.tags (OR semantics) composes with goal scope;
    // prerequisite completion is still evaluated against all tasks in the project.
    async nextActionable(
      projectId: string,
      filter: { goalId?: string; tags?: string[] } = {},
    ): Promise<NextActionableResult | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      let goalIds: Set<string>;
      if (filter.goalId === undefined) {
        const active = (await listGoals(db, projectId)).filter((goal) => goal.status === 'active');
        if (active.length === 0) {
          return { next_task: null, reason: 'no_active_goal', blocked: [] };
        }
        // #18: no dead-end on ambiguity — consider the union of every active
        // goal's tasks instead of erroring when goal_id is omitted.
        goalIds = new Set(active.map((goal) => goal.id));
      } else {
        if (!(await listGoals(db, projectId)).some((goal) => goal.id === filter.goalId)) {
          return undefined;
        }
        goalIds = new Set([filter.goalId]);
      }

      const tasks = (await listTasks(db, projectId)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const edges = await listEdges(db, projectId);
      const taskById = new Map<string, Task>(tasks.map((task) => [task.id, task]));
      // Status map from tasks already loaded — no extra query on this path.
      const statusById = new Map(tasks.map((task) => [task.id, task.status]));
      const tagsByTask = await listTagsByTaskForProject(db, projectId);
      const tagMatches =
        filter.tags !== undefined && filter.tags.length > 0
          ? await taskIdsWithAnyTagName(db, projectId, filter.tags.map(normalizeTagName))
          : undefined;
      const serialize = (task: Task) => serializeTask(task, tagsByTask.get(task.id) ?? []);
      const prerequisites = buildPrerequisiteMap(edges);

      if (tasks.length === 0) {
        return { next_task: null, reason: 'no_tasks', blocked: [] };
      }

      const todoTasks = tasks.filter(
        (task) =>
          goalIds.has(task.goalId) &&
          task.status === 'todo' &&
          (tagMatches === undefined || tagMatches.has(task.id)),
      );
      if (todoTasks.length === 0) {
        return { next_task: null, reason: 'no_todo_tasks', blocked: [] };
      }

      const blocked: NextActionableResult['blocked'] = [];
      let nextTask: SerializedTask | null = null;

      for (const task of todoTasks) {
        const waitingIds = unfinishedPrerequisiteIds(task.id, prerequisites, statusById);
        if (waitingIds.length === 0) {
          if (nextTask === null) {
            nextTask = serialize(task);
          }
        } else {
          blocked.push({
            task: serialize(task),
            waiting_on: waitingIds
              .map((id) => taskById.get(id))
              .filter((row): row is Task => row !== undefined)
              .map(serialize),
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
