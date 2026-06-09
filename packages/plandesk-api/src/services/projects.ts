import {
  clearDocumentParentRefsByProject,
  createDocument,
  createEdge,
  createProject as dbCreateProject,
  createTask,
  deleteAgentRun,
  deleteAgentRunEventsByRunId,
  deleteCommentsByProjectId,
  deleteDocumentsByProjectId,
  deleteEdgesByProjectId,
  deleteShareSubmissionsByProjectId,
  deleteSharesByProjectId,
  deleteSyncStateByProjectId,
  deleteProject as dbDeleteProject,
  deleteTasksByProjectId,
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
import type { EventBus } from '../events.js';
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
  name: string;
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

export type ProjectServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CreateProjectInput = {
  name: string;
  description?: string | null;
};

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
};

function summarizeTasks(tasks: ReturnType<typeof listTasks>): TaskStatusSummary {
  const summary = emptyTaskStatusSummary();
  for (const task of tasks) {
    summary[task.status] += 1;
  }
  return summary;
}

export function createProjectService(deps: ProjectServiceDeps) {
  const { db, eventBus } = deps;

  return {
    create(input: CreateProjectInput) {
      const project = dbCreateProject(db, input);
      return serializeProject(project);
    },

    list(pagination: PaginationParams = {}) {
      return dbListProjects(db, pagination).map(serializeProject);
    },

    get(id: string) {
      const project = dbGetProject(db, id);
      if (!project) {
        return undefined;
      }
      const summary = summarizeTasks(listTasks(db, id));
      return serializeProjectDetail(project, summary);
    },

    update(id: string, input: UpdateProjectInput) {
      const project = dbUpdateProject(db, id, input);
      if (!project) {
        return undefined;
      }
      return serializeProject(project);
    },

    delete(id: string) {
      const project = dbGetProject(db, id);
      if (!project) {
        return false;
      }

      db.transaction((tx) => {
        const runs = listAgentRuns(tx, id);
        for (const run of runs) {
          deleteAgentRunEventsByRunId(tx, run.id);
        }
        for (const run of runs) {
          deleteAgentRun(tx, run.id);
        }
        deleteEdgesByProjectId(tx, id);
        clearDocumentParentRefsByProject(tx, id);
        deleteCommentsByProjectId(tx, id);
        deleteDocumentsByProjectId(tx, id);
        deleteTasksByProjectId(tx, id);
        deleteShareSubmissionsByProjectId(tx, id);
        deleteSyncStateByProjectId(tx, id);
        deleteSharesByProjectId(tx, id);
        dbDeleteProject(tx, id);
      });

      eventBus.emit({ type: 'canvas_updated', projectId: id });
      return true;
    },

    scaffoldFromPlan(input: ScaffoldPlanInput): ScaffoldPlanResult {
      validateScaffoldInput(input);

      const taskRows: Task[] = [];
      const edgeRows: Edge[] = [];
      const documentRows: Document[] = [];
      const keyToId = new Map<string, string>();
      let projectId = '';

      db.transaction((tx) => {
        const project = dbCreateProject(tx, {
          name: input.name,
          description: input.description,
        });
        projectId = project.id;

        input.tasks.forEach((taskInput, i) => {
          const x = taskInput.x ?? (i % 4) * 240;
          const y = taskInput.y ?? Math.floor(i / 4) * 160;
          const task = createTask(tx, {
            projectId: project.id,
            label: taskInput.label,
            status: taskInput.status,
            description: taskInput.description,
            x,
            y,
          });
          keyToId.set(taskInput.key, task.id);
          taskRows.push(task);
        });

        for (const edgeInput of input.edges ?? []) {
          const fromTaskId = keyToId.get(edgeInput.from);
          const toTaskId = keyToId.get(edgeInput.to);
          if (fromTaskId === undefined || toTaskId === undefined) {
            throw new InvalidScaffoldError('edge references unknown task key');
          }
          const edge = createEdge(tx, {
            projectId: project.id,
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
          const document = createDocument(tx, {
            projectId: project.id,
            title: docInput.title,
            body: docInput.body,
            statusLine: docInput.statusLine,
            linkedTaskId: linkedTaskId ?? null,
          });
          documentRows.push(document);
        }
      });

      eventBus.emit({ type: 'canvas_updated', projectId });
      for (const doc of documentRows) {
        eventBus.emit({ type: 'document_created', documentId: doc.id, projectId });
      }

      const project = dbGetProject(db, projectId);
      if (!project) {
        throw new Error('scaffolded project missing after transaction');
      }

      return {
        project: serializeProject(project),
        tasks: taskRows.map(serializeTask),
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
