import {
  withTransaction,
  clearDocumentParentRefsByProject,
  clearFolderParentRefsByProject,
  createDocument,
  createEdge,
  createProject as dbCreateProject,
  createTask,
  deleteAgentRun,
  deleteAgentRunEventsByRunId,
  deleteCommentsByProjectId,
  deleteDocumentsByProjectId,
  deleteFoldersByProjectId,
  deleteNotesByProjectId,
  deleteEdgesByProjectId,
  deleteGoalsByProjectId,
  deleteShareSubmissionsByProjectId,
  deleteSharesByProjectId,
  deleteTagsByProjectId,
  deleteSyncRemoteByProjectId,
  deleteSyncStateByProjectId,
  deleteProject as dbDeleteProject,
  deleteTasksByProjectId,
  getOrCreateDefaultGoal,
  getProject as dbGetProject,
  InvalidTaskStatusError,
  isTaskStatus,
  listAgentRuns,
  listProjects as dbListProjects,
  listTasks,
  updateProject as dbUpdateProject,
  type Db,
  type Document,
  type Edge,
  type Task,
  type TaskStatus,
} from '@plandesk/db';
import {
  emptyTaskStatusSummary,
  serializeDocument,
  serializeEdge,
  serializeProject,
  serializeProjectDetail,
  serializeTask,
  type PaginationParams,
  type SerializedDocument,
  type TaskStatusSummary,
} from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

type SerializedProject = ReturnType<typeof serializeProject>;
type SerializedTask = ReturnType<typeof serializeTask>;
type SerializedEdge = ReturnType<typeof serializeEdge>;

export class InvalidScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScaffoldError';
  }
}

export type ScaffoldTaskInput = {
  key: string;
  label: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
};

export type ScaffoldEdgeInput = {
  from: string;
  to: string;
  label?: string | null;
  style?: string | null;
};

export type ScaffoldDocumentInput = {
  title: string;
  body?: string | null;
  statusLine?: string | null;
  linkTo?: string;
};

export type ScaffoldPlanInput = {
  /** Target an existing project; when set, the plan is added to it. Omit to create a new project. */
  projectId?: string;
  /** Name for a new project. Required when projectId is omitted; ignored when it is set. */
  name?: string;
  description?: string | null;
  tasks: ScaffoldTaskInput[];
  edges?: ScaffoldEdgeInput[];
  documents?: ScaffoldDocumentInput[];
};

export type ScaffoldPlanResult = {
  project: SerializedProject;
  tasks: SerializedTask[];
  edges: SerializedEdge[];
  documents: SerializedDocument[];
  key_to_id: Record<string, string>;
  counts: { tasks: number; edges: number; documents: number };
};

function validateScaffoldInput(input: ScaffoldPlanInput): void {
  if (input.tasks.length === 0) {
    throw new InvalidScaffoldError('tasks must not be empty');
  }

  const keys = new Set<string>();
  for (const task of input.tasks) {
    if (task.key.trim() === '') {
      throw new InvalidScaffoldError('task key must not be empty');
    }
    if (keys.has(task.key)) {
      throw new InvalidScaffoldError(`duplicate task key: ${task.key}`);
    }
    keys.add(task.key);
    if (task.status !== undefined && !isTaskStatus(task.status)) {
      throw new InvalidTaskStatusError(task.status);
    }
  }

  for (const edge of input.edges ?? []) {
    if (!keys.has(edge.from)) {
      throw new InvalidScaffoldError(`edge references unknown task key: ${edge.from}`);
    }
    if (!keys.has(edge.to)) {
      throw new InvalidScaffoldError(`edge references unknown task key: ${edge.to}`);
    }
    if (edge.from === edge.to) {
      throw new InvalidScaffoldError('edge cannot reference the same task for from and to');
    }
  }

  for (const doc of input.documents ?? []) {
    if (doc.linkTo !== undefined && !keys.has(doc.linkTo)) {
      throw new InvalidScaffoldError(`document linkTo references unknown task key: ${doc.linkTo}`);
    }
  }
}

export type ProjectServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreateProjectInput = {
  name: string;
  description?: string | null;
};

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
};

function summarizeTasks(tasks: Task[]): TaskStatusSummary {
  const summary = emptyTaskStatusSummary();
  for (const task of tasks) {
    summary[task.status] += 1;
  }
  return summary;
}

export function createProjectService(deps: ProjectServiceDeps) {
  const { db } = deps;

  return {
    async create(input: CreateProjectInput) {
      assertPermission(deps, 'project', 'create');
      const orgId = resolveOrgId(deps);
      const project = await dbCreateProject(db, { ...input, orgId });
      return serializeProject(project);
    },

    async list(pagination: PaginationParams = {}) {
      const orgId = resolveOrgId(deps);
      return (await dbListProjects(db, orgId, pagination)).map(serializeProject);
    },

    async get(id: string) {
      const orgId = resolveOrgId(deps);
      try {
        const project = await assertProjectInOrg(db, id, orgId);
        const summary = summarizeTasks(await listTasks(db, id));
        return serializeProjectDetail(project, summary);
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
    },

    async update(id: string, input: UpdateProjectInput) {
      assertPermission(deps, 'task', 'update');
      const orgId = resolveOrgId(deps);
      try {
        await assertProjectInOrg(db, id, orgId);
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      const project = await dbUpdateProject(db, id, input);
      if (!project) {
        return undefined;
      }
      return serializeProject(project);
    },

    async delete(id: string) {
      assertPermission(deps, 'project', 'delete');
      const orgId = resolveOrgId(deps);
      try {
        await assertProjectInOrg(db, id, orgId);
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      await withTransaction(db, async (tx) => {
        const runs = await listAgentRuns(tx, id);
        for (const run of runs) {
          await deleteAgentRunEventsByRunId(tx, run.id);
        }
        for (const run of runs) {
          await deleteAgentRun(tx, run.id);
        }
        await deleteEdgesByProjectId(tx, id);
        await clearDocumentParentRefsByProject(tx, id);
        await deleteCommentsByProjectId(tx, id);
        await deleteDocumentsByProjectId(tx, id);
        await clearFolderParentRefsByProject(tx, id);
        await deleteFoldersByProjectId(tx, id);
        await deleteNotesByProjectId(tx, id);
        await deleteTagsByProjectId(tx, id);
        await deleteTasksByProjectId(tx, id);
        await deleteGoalsByProjectId(tx, id);
        await deleteShareSubmissionsByProjectId(tx, id);
        await deleteSyncStateByProjectId(tx, id);
        await deleteSyncRemoteByProjectId(tx, id);
        await deleteSharesByProjectId(tx, id);
        await dbDeleteProject(tx, id);
      });

      return true;
    },

    async scaffoldFromPlan(input: ScaffoldPlanInput): Promise<ScaffoldPlanResult> {
      // New project needs manager; adding plan content to an existing project needs editor.
      assertPermission(
        deps,
        input.projectId === undefined ? 'project' : 'task',
        input.projectId === undefined ? 'create' : 'create',
      );
      validateScaffoldInput(input);
      const orgId = resolveOrgId(deps);

      const taskRows: Task[] = [];
      const edgeRows: Edge[] = [];
      const documentRows: Document[] = [];
      const keyToId = new Map<string, string>();
      let projectId = '';

      await withTransaction(db, async (tx) => {
        let startRow = 0;
        if (input.projectId !== undefined) {
          let existing;
          try {
            existing = await assertProjectInOrg(tx, input.projectId, orgId);
          } catch (error) {
            if (error instanceof ProjectNotInOrgError) {
              throw new InvalidScaffoldError(`project not found: ${input.projectId}`);
            }
            throw error;
          }
          projectId = existing.id;
          const existingTasks = await listTasks(tx, existing.id);
          if (existingTasks.length > 0) {
            const maxY = existingTasks.reduce((m, t) => Math.max(m, t.y ?? 0), 0);
            startRow = Math.floor(maxY / 160) + 1;
          }
        } else {
          if (input.name === undefined || input.name.trim() === '') {
            throw new InvalidScaffoldError(
              'name is required to create a new project (or pass projectId to add to an existing one)',
            );
          }
          const project = await dbCreateProject(tx, {
            name: input.name,
            description: input.description,
            orgId,
          });
          projectId = project.id;
        }
        const defaultGoal = await getOrCreateDefaultGoal(tx, projectId);

        for (const [i, taskInput] of input.tasks.entries()) {
          const x = taskInput.x ?? (i % 4) * 240;
          const y = taskInput.y ?? (startRow + Math.floor(i / 4)) * 160;
          const task = await createTask(tx, {
            projectId,
            goalId: defaultGoal.id,
            label: taskInput.label,
            status: taskInput.status,
            description: taskInput.description,
            x,
            y,
          });
          keyToId.set(taskInput.key, task.id);
          taskRows.push(task);
        }

        for (const edgeInput of input.edges ?? []) {
          const fromTaskId = keyToId.get(edgeInput.from);
          const toTaskId = keyToId.get(edgeInput.to);
          if (fromTaskId === undefined || toTaskId === undefined) {
            throw new InvalidScaffoldError('edge references unknown task key');
          }
          const edge = await createEdge(tx, {
            projectId,
            fromTaskId,
            toTaskId,
            label: edgeInput.label ?? null,
            style: edgeInput.style ?? null,
          });
          edgeRows.push(edge);
        }

        for (const docInput of input.documents ?? []) {
          const linkedTaskId =
            docInput.linkTo !== undefined ? keyToId.get(docInput.linkTo) : undefined;
          const document = await createDocument(tx, {
            projectId,
            title: docInput.title,
            body: docInput.body,
            statusLine: docInput.statusLine,
            linkedTaskId: linkedTaskId ?? null,
          });
          documentRows.push(document);
        }
      });

      const project = await dbGetProject(db, projectId);
      if (!project) {
        throw new Error('scaffolded project missing after transaction');
      }

      return {
        project: serializeProject(project),
        tasks: taskRows.map((task) => serializeTask(task)),
        edges: edgeRows.map(serializeEdge),
        documents: documentRows.map(serializeDocument),
        key_to_id: Object.fromEntries(keyToId),
        counts: {
          tasks: taskRows.length,
          edges: edgeRows.length,
          documents: documentRows.length,
        },
      };
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
