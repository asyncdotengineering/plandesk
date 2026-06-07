import {
  createProject as dbCreateProject,
  getProject as dbGetProject,
  listProjects as dbListProjects,
  listTasks,
  type Db,
} from '@plandesk/db';
import {
  emptyTaskStatusSummary,
  serializeProject,
  serializeProjectDetail,
  type TaskStatusSummary,
} from '../serialize.js';

export type ProjectServiceDeps = {
  db: Db;
};

export type CreateProjectInput = {
  name: string;
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
  const { db } = deps;

  return {
    create(input: CreateProjectInput) {
      const project = dbCreateProject(db, input);
      return serializeProject(project);
    },

    list() {
      return dbListProjects(db).map(serializeProject);
    },

    get(id: string) {
      const project = dbGetProject(db, id);
      if (!project) {
        return undefined;
      }
      const summary = summarizeTasks(listTasks(db, id));
      return serializeProjectDetail(project, summary);
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
