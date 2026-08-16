import {
  InvalidSavedViewConfigError,
  listGoals,
  parseSavedViewConfig,
  type Db,
  type SavedViewConfig,
} from '@plandesk/db';
import { buildExportFilename, contentDispositionAttachment } from '../export/filename.js';
import { CSV_CONTENT_TYPE, renderCsv, renderXlsx, XLSX_CONTENT_TYPE } from '../export/render.js';
import { buildExportTable } from '../export/view-rows.js';
import type { ExportTask } from '../export/view-eval.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
import type { ProjectService } from './projects.js';
import type { TaskService } from './tasks.js';

export type ProjectExportServiceDeps = OrgScopedDeps & {
  db: Db;
  projectService: ProjectService;
  taskService: TaskService;
};

export type ExportFormat = 'csv' | 'xlsx';

export type ProjectExportResult = {
  body: Uint8Array;
  contentType: string;
  filename: string;
  contentDisposition: string;
};

export class InvalidExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExportRequestError';
  }
}

export type ProjectExportService = {
  exportView(
    projectId: string,
    input: { format: unknown; view: unknown },
    options?: { now?: Date },
  ): Promise<ProjectExportResult | undefined>;
};

function parseFormat(value: unknown): ExportFormat {
  if (value === 'csv' || value === 'xlsx') {
    return value;
  }
  throw new InvalidExportRequestError('format must be csv or xlsx');
}

function asExportTasks(tasks: Awaited<ReturnType<TaskService['listByProject']>>): ExportTask[] {
  if (tasks === undefined) {
    return [];
  }
  return tasks.map((task) => ({
    id: task.id,
    label: task.label,
    status: task.status,
    priority: task.priority,
    lane: task.lane,
    severity: task.severity,
    description: task.description,
    assignee: task.assignee,
    due_date: task.due_date,
    created_at: task.created_at,
    updated_at: task.updated_at,
    goal_id: task.goal_id,
    ...(task.tags !== undefined ? { tags: task.tags } : {}),
    ...(task.blocked !== undefined ? { blocked: task.blocked } : {}),
  }));
}

export function createProjectExportService(deps: ProjectExportServiceDeps): ProjectExportService {
  const { db, projectService, taskService } = deps;

  return {
    async exportView(projectId, input, options) {
      let format: ExportFormat;
      let view: SavedViewConfig;
      try {
        format = parseFormat(input.format);
        view = parseSavedViewConfig(input.view);
      } catch (error) {
        if (
          error instanceof InvalidExportRequestError ||
          error instanceof InvalidSavedViewConfigError
        ) {
          throw new InvalidExportRequestError(error.message);
        }
        throw error;
      }

      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const project = await projectService.get(projectId);
      if (project === undefined) {
        return undefined;
      }

      const tasks = await taskService.listByProject(projectId);
      if (tasks === undefined) {
        return undefined;
      }

      const goals = await listGoals(db, projectId);
      const goalLabels = new Map(goals.map((goal) => [goal.id, goal.objective]));
      const table = buildExportTable(asExportTasks(tasks), view, goalLabels);
      const now = options?.now ?? new Date();
      const filename = buildExportFilename(project.name, format, now);

      if (format === 'csv') {
        const body = new TextEncoder().encode(renderCsv(table));
        return {
          body,
          contentType: CSV_CONTENT_TYPE,
          filename,
          contentDisposition: contentDispositionAttachment(filename),
        };
      }

      return {
        body: await renderXlsx(table),
        contentType: XLSX_CONTENT_TYPE,
        filename,
        contentDisposition: contentDispositionAttachment(filename),
      };
    },
  };
}
