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
  deleteArtifactsByProjectId,
  deleteCommentsByProjectId,
  deleteRevisionsByProjectId,
  deleteDocumentsByProjectId,
  deleteFoldersByProjectId,
  deleteNotesByProjectId,
  deleteEdgesByProjectId,
  deleteGoalsByProjectId,
  deletePrototypesByProjectId,
  deleteShareSubmissionsByProjectId,
  deleteSharesByProjectId,
  deleteTagsByProjectId,
  deleteViewsByProjectId,
  deleteSyncRemoteByProjectId,
  deleteSyncStateByProjectId,
  deleteProject as dbDeleteProject,
  deleteTasksByProjectId,
  resolveGoalForNewWork,
  listGoals,
  getProject as dbGetProject,
  getProjectInOrg,
  InvalidTaskStatusError,
  isTaskStatus,
  listAgentRuns,
  listEdges,
  listProjects as dbListProjects,
  listTasks,
  updateDocument,
  updateProject as dbUpdateProject,
  getDocumentByProjectAndId,
  type Db,
  type DbClient,
  type Document,
  type Edge,
  type Task,
  type TaskStatus,
} from '@plandesk/db';
import { ensureWikiLinkEdges, prepareDocumentBody } from '../document-wiki-links.js';
import { ensureDefaultTeamForOrg, getTeamInOrg } from '../identity.js';
import type { BetterAuthInstance } from '../better-auth.js';
import { InvalidGoalReferenceError } from './tasks.js';
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
import { tryGetAuthContext } from '../auth-context.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { PermissionDeniedError } from '../permissions.js';
import {
  assertProjectInOrg,
  ProjectNotInOrgError,
  WorkspaceNotFoundError,
} from './scope.js';

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
  /** Overrides the call-level goalId for this task. */
  goalId?: string;
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
  /** Goal to attach scaffolded tasks to. Must belong to the target project; omit for the default goal. */
  goalId?: string;
  /** Name for a new project. Required when projectId is omitted; ignored when it is set. */
  name?: string;
  description?: string | null;
  /** Target workspace (team) for a new project. A workspace/project-scoped agent
   * key must target its own scope (or omit this to default to it); a mismatch is
   * a 404. Ignored when projectId is set. */
  workspaceId?: string;
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

/**
 * Resolve the workspace a new project lands in. A workspace/project-scoped
 * agent key is forced into its own workspace (no explicit target, or a target
 * that must equal its scope); an org-wide caller may pass a workspace
 * (validated in-org) or fall back to the org default. Shared by create() and
 * scaffoldFromPlan() so the two new-project paths cannot drift again.
 */
async function resolveWorkspaceForNewProject(
  deps: ProjectServiceDeps,
  client: DbClient,
  requestedWorkspaceId: string | undefined,
): Promise<string> {
  const orgId = resolveOrgId(deps);
  const ctx = tryGetAuthContext();
  let callerWorkspaceId: string | undefined;
  if (ctx?.kind === 'apikey') {
    if (ctx.workspaceId !== undefined) {
      callerWorkspaceId = ctx.workspaceId;
    } else if (ctx.projectId !== undefined) {
      callerWorkspaceId = (await getProjectInOrg(client, ctx.projectId, orgId))?.workspaceId;
    }
  }

  let workspaceId: string | undefined;
  if (requestedWorkspaceId !== undefined && requestedWorkspaceId.length > 0) {
    if (deps.auth === undefined) {
      throw new WorkspaceNotFoundError(requestedWorkspaceId);
    }
    const team = await getTeamInOrg(deps.auth, requestedWorkspaceId, orgId);
    if (team === undefined) {
      throw new WorkspaceNotFoundError(requestedWorkspaceId);
    }
    workspaceId = team.id;
  } else if (callerWorkspaceId !== undefined) {
    // Scoped key without an explicit target: force its own workspace so it
    // can never land a project in the org-default (or any other) workspace.
    workspaceId = callerWorkspaceId;
  } else {
    workspaceId = deps.auth ? await ensureDefaultTeamForOrg(deps.auth, orgId) : undefined;
  }
  if (workspaceId === undefined) {
    throw new Error('cannot resolve workspace for project');
  }
  if (callerWorkspaceId !== undefined && workspaceId !== callerWorkspaceId) {
    throw new WorkspaceNotFoundError(workspaceId);
  }
  return workspaceId;
}

export type ProjectServiceDeps = OrgScopedDeps & {
  db: Db;
  auth?: BetterAuthInstance;
};

export type CreateProjectInput = {
  name: string;
  description?: string | null;
  ownerId?: string | null;
  overviewDocumentId?: string | null;
  repoUrl?: string | null;
  folderPath?: string | null;
  workspaceId?: string;
};

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
  ownerId?: string | null;
  overviewDocumentId?: string | null;
  repoUrl?: string | null;
  folderPath?: string | null;
};

export class InvalidOverviewDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOverviewDocumentError';
  }
}

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
      const workspaceId = await resolveWorkspaceForNewProject(deps, db, input.workspaceId);
      // Overview cannot be set on create: the document must already belong to the
      // project, which does not exist yet. Reject a non-null pin rather than
      // silently dropping it.
      if (input.overviewDocumentId !== undefined && input.overviewDocumentId !== null) {
        throw new InvalidOverviewDocumentError(
          'overview_document_id cannot be set when creating a project',
        );
      }
      const project = await dbCreateProject(db, {
        name: input.name,
        orgId,
        workspaceId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.repoUrl !== undefined ? { repoUrl: input.repoUrl } : {}),
        ...(input.folderPath !== undefined ? { folderPath: input.folderPath } : {}),
      });
      return serializeProject(project);
    },

    async list(pagination: PaginationParams = {}) {
      const orgId = resolveOrgId(deps);
      const ctx = tryGetAuthContext();
      // RFC§12: a session member sees only projects in their workspaces.
      // Owner/admin and other contexts keep their existing scoping below.
      if (ctx?.kind === 'session' && ctx.role === 'member') {
        return (
          await dbListProjects(db, orgId, { ...pagination, workspaceIds: ctx.memberWorkspaceIds })
        ).map(serializeProject);
      }
      // A project-scoped agent key sees only its own project (a key with
      // ctx.projectId and no workspaceId would otherwise enumerate every org
      // project). getProjectInOrg also enforces org membership.
      if (ctx?.kind === 'apikey' && ctx.projectId !== undefined) {
        const project = await getProjectInOrg(db, ctx.projectId, orgId);
        return project === undefined ? [] : [serializeProject(project)];
      }
      const workspaceId =
        (ctx?.kind === 'apikey' || ctx?.kind === 'loopback') && ctx.workspaceId !== undefined
          ? ctx.workspaceId
          : undefined;
      return (await dbListProjects(db, orgId, { ...pagination, workspaceId })).map(
        serializeProject,
      );
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
      if (input.overviewDocumentId !== undefined && input.overviewDocumentId !== null) {
        const overview = await getDocumentByProjectAndId(db, id, input.overviewDocumentId);
        if (overview === undefined) {
          // Unknown, wrong-project, and cross-org document ids all look the same.
          throw new InvalidOverviewDocumentError(
            'overview_document_id must refer to a document in this project',
          );
        }
      }
      const project = await dbUpdateProject(db, id, input);
      if (!project) {
        return undefined;
      }
      return serializeProject(project);
    },

    /**
     * Move a project to another workspace (team) in the caller's org.
     *
     * Owner-gated: a workspace/project-scoped agent key must not move projects
     * (it would drag a project out of its scope), so scoped callers are rejected
     * before any existence check. Requires project:create authority (owner/admin).
     * The target team must exist in the caller's org; otherwise 404.
     */
    async moveProjectToWorkspace(id: string, workspaceId: string) {
      const ctx = tryGetAuthContext();
      const scoped =
        ctx !== undefined &&
        ((ctx.kind === 'apikey' &&
          (ctx.workspaceId !== undefined || ctx.projectId !== undefined)) ||
          (ctx.kind === 'loopback' && ctx.workspaceId !== undefined));
      if (scoped) {
        throw new PermissionDeniedError('project', 'create');
      }
      assertPermission(deps, 'project', 'create');
      const orgId = resolveOrgId(deps);
      try {
        await assertProjectInOrg(db, id, orgId);
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (deps.auth === undefined) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      const team = await getTeamInOrg(deps.auth, workspaceId, orgId);
      if (team === undefined) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      const project = await dbUpdateProject(db, id, { workspaceId: team.id });
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
        // Null the overview pin before deleting documents — the FK from projects
        // to documents would otherwise reject the document deletes.
        await dbUpdateProject(tx, id, { overviewDocumentId: null });
        await clearDocumentParentRefsByProject(tx, id);
        await deleteCommentsByProjectId(tx, id);
        await deleteRevisionsByProjectId(tx, id);
        await deleteDocumentsByProjectId(tx, id);
        await clearFolderParentRefsByProject(tx, id);
        await deleteFoldersByProjectId(tx, id);
        await deleteNotesByProjectId(tx, id);
        await deleteTagsByProjectId(tx, id);
        await deleteViewsByProjectId(tx, id);
        await deleteTasksByProjectId(tx, id);
        await deleteGoalsByProjectId(tx, id);
        await deleteShareSubmissionsByProjectId(tx, id);
        await deleteSyncStateByProjectId(tx, id);
        await deleteSyncRemoteByProjectId(tx, id);
        await deleteSharesByProjectId(tx, id);
        // Artifacts before prototypes: screens hold prototype_id FK.
        await deleteArtifactsByProjectId(tx, id);
        await deletePrototypesByProjectId(tx, id);
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
            const maxY = existingTasks.reduce((m, t) => Math.max(m, t.y), 0);
            startRow = Math.floor(maxY / 160) + 1;
          }
        } else {
          if (input.name === undefined || input.name.trim() === '') {
            throw new InvalidScaffoldError(
              'name is required to create a new project (or pass projectId to add to an existing one)',
            );
          }
          const workspaceId = await resolveWorkspaceForNewProject(deps, tx, input.workspaceId);
          const project = await dbCreateProject(tx, {
            name: input.name,
            description: input.description,
            orgId,
            workspaceId,
          });
          projectId = project.id;
        }
        if (
          input.goalId !== undefined &&
          !(await listGoals(tx, projectId)).some((goal) => goal.id === input.goalId)
        ) {
          throw new InvalidGoalReferenceError(input.goalId);
        }
        const projectGoals = await listGoals(tx, projectId);
        for (const taskInput of input.tasks) {
          if (
            taskInput.goalId !== undefined &&
            !projectGoals.some((goal) => goal.id === taskInput.goalId)
          ) {
            throw new InvalidGoalReferenceError(taskInput.goalId);
          }
        }
        let defaultGoalId: string | undefined;

        for (const [i, taskInput] of input.tasks.entries()) {
          let taskGoalId: string;
          if (taskInput.goalId !== undefined) {
            taskGoalId = taskInput.goalId;
          } else if (input.goalId !== undefined) {
            taskGoalId = input.goalId;
          } else {
            defaultGoalId ??= (await resolveGoalForNewWork(tx, projectId)).id;
            taskGoalId = defaultGoalId;
          }
          const x = taskInput.x ?? (i % 4) * 240;
          const y = taskInput.y ?? (startRow + Math.floor(i / 4)) * 160;
          const task = await createTask(tx, {
            projectId,
            goalId: taskGoalId,
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
          const linkTaskId =
            docInput.linkTo !== undefined ? keyToId.get(docInput.linkTo) : undefined;
          const document = await createDocument(tx, {
            projectId,
            title: docInput.title,
            body: docInput.body,
            statusLine: docInput.statusLine,
          });
          // Document→task edge is the sole link. Not pushed onto edgeRows —
          // scaffold `edges`/`counts.edges` stay the plan's task-graph edges;
          // the document link is reflected on the document payload.
          if (linkTaskId !== undefined) {
            await createEdge(tx, {
              projectId,
              fromType: 'document',
              fromId: document.id,
              toType: 'task',
              toId: linkTaskId,
              label: 'documents',
            });
          }
          documentRows.push(document);
        }

        for (const document of documentRows) {
          if (document.body === null) {
            continue;
          }
          const prepared = prepareDocumentBody(
            document.body,
            projectId,
            documentRows,
            document.id,
          );
          if (prepared.body !== document.body) {
            const updated = await updateDocument(tx, document.id, { body: prepared.body });
            if (updated !== undefined) {
              document.body = updated.body;
            }
          }
          await ensureWikiLinkEdges(tx, projectId, document.id, prepared.resolved);
        }
      });

      const project = await dbGetProject(db, projectId);
      if (!project) {
        throw new Error('scaffolded project missing after transaction');
      }

      // Hydrate document links from the edges just written (and any pre-existing).
      const allEdges = await listEdges(db, projectId);
      const documents = documentRows.map((document) => {
        const links = allEdges
          .filter((edge) => edge.fromType === 'document' && edge.fromId === document.id)
          .map((edge) => {
            const title =
              edge.toType === 'task'
                ? (taskRows.find((t) => t.id === edge.toId)?.label ?? edge.toId)
                : (documentRows.find((d) => d.id === edge.toId)?.title ?? edge.toId);
            return {
              type: edge.toType,
              id: edge.toId,
              title,
              label: edge.label,
              edge_id: edge.id,
            };
          });
        const backlinks = allEdges
          .filter((edge) => edge.toType === 'document' && edge.toId === document.id)
          .map((edge) => {
            const title =
              edge.fromType === 'task'
                ? (taskRows.find((t) => t.id === edge.fromId)?.label ?? edge.fromId)
                : (documentRows.find((d) => d.id === edge.fromId)?.title ?? edge.fromId);
            return {
              type: edge.fromType,
              id: edge.fromId,
              title,
              label: edge.label,
              edge_id: edge.id,
            };
          });
        return serializeDocument(document, { links, backlinks });
      });

      return {
        project: serializeProject(project),
        tasks: taskRows.map((task) => serializeTask(task)),
        edges: edgeRows.map(serializeEdge),
        documents,
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
