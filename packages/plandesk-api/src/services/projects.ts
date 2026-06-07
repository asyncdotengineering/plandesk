import {
  clearDocumentParentRefsByProject,
  createProject as dbCreateProject,
  deleteAgentRun,
  deleteAgentRunEventsByRunId,
  deleteDocumentsByProjectId,
  deleteEdgesByProjectId,
  deleteProject as dbDeleteProject,
  deleteTasksByProjectId,
  getProject as dbGetProject,
  listAgentRuns,
  listProjects as dbListProjects,
  listTasks,
  updateProject as dbUpdateProject,
  type Db,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import {
  emptyTaskStatusSummary,
  serializeProject,
  serializeProjectDetail,
  type PaginationParams,
  type TaskStatusSummary,
} from '../serialize.js';

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
        deleteDocumentsByProjectId(tx, id);
        deleteTasksByProjectId(tx, id);
        dbDeleteProject(tx, id);
      });

      eventBus.emit({ type: 'canvas_updated', projectId: id });
      return true;
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
