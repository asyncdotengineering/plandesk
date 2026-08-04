import { invalidArgument, invalidRequest } from './errors.js';
import { Hono } from 'hono';
import {
  InvalidTaskKindError,
  InvalidTaskLaneError,
  InvalidTaskPriorityError,
  InvalidTaskStatusError,
  InvalidTaskSeverityError,
  UnstoredColumnError,
  isTaskKind,
  isTaskLane,
  isTaskPriority,
  isTaskSeverity,
  isTaskStatus,
  isValidFolderPath,
  isValidRegisteredRepoRoot,
  isValidRepoUrl,
} from '@plandesk/db';
import type { ProjectService } from '../services/projects.js';
import { InvalidOverviewDocumentError } from '../services/projects.js';
import {
  InvalidExportRequestError,
  type ProjectExportService,
} from '../services/project-export.js';
import { InvalidGoalReferenceError, type TaskService } from '../services/tasks.js';
import { InvalidTagError } from '../services/tags.js';
import { isStringArray } from './tasks.js';
import { parsePaginationParams } from '../serialize.js';
import { WorkspaceNotFoundError } from '../services/scope.js';

export function createProjectsRouter(
  projectService: ProjectService,
  taskService: TaskService,
  exportService: ProjectExportService,
): Hono {
  const router = new Hono();

  router.get('/projects', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return invalidRequest(c, 'limit and offset must be non-negative integers');
    }
    return c.json(await projectService.list(pagination));
  });

  router.post('/projects', async (c) => {
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      owner_id?: string | null;
      overview_document_id?: string | null;
      repo_url?: string | null;
      folder_path?: string | null;
      workspace_id?: string;
    }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return invalidArgument(c, 'name', 'name is required and must be a non-empty string');
    }
    if (
      body.owner_id !== undefined &&
      body.owner_id !== null &&
      (typeof body.owner_id !== 'string' || body.owner_id.trim() === '')
    ) {
      return invalidArgument(c, 'owner_id', 'owner_id is required and must be a non-empty string');
    }
    if (
      body.overview_document_id !== undefined &&
      body.overview_document_id !== null &&
      typeof body.overview_document_id !== 'string'
    ) {
      return invalidArgument(c, 'overview_document_id', 'overview_document_id must be a string');
    }
    if (body.repo_url !== undefined && body.repo_url !== null) {
      if (typeof body.repo_url !== 'string' || !isValidRepoUrl(body.repo_url)) {
        return invalidArgument(c, 'repo_url', 'repo_url must be a string');
      }
    }
    if (body.folder_path !== undefined && body.folder_path !== null) {
      if (typeof body.folder_path !== 'string' || !isValidFolderPath(body.folder_path)) {
        return invalidArgument(c, 'folder_path', 'folder_path must be a string');
      }
    }
    const workspaceId =
      typeof body.workspace_id === 'string' && body.workspace_id.length > 0
        ? body.workspace_id
        : undefined;
    try {
      const project = await projectService.create({
        name: body.name,
        description: body.description,
        ...(body.owner_id !== undefined ? { ownerId: body.owner_id } : {}),
        ...(body.overview_document_id !== undefined
          ? { overviewDocumentId: body.overview_document_id }
          : {}),
        ...(body.repo_url !== undefined ? { repoUrl: body.repo_url } : {}),
        ...(body.folder_path !== undefined ? { folderPath: body.folder_path } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (error instanceof InvalidOverviewDocumentError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
  });

  router.get('/projects/:id', async (c) => {
    const project = await projectService.get(c.req.param('id'));
    if (!project) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(project);
  });

  router.patch('/projects/:id', async (c) => {
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      owner_id?: string | null;
      overview_document_id?: string | null;
      repo_url?: string | null;
      folder_path?: string | null;
      workspace_id?: string | null;
    }>();
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      return invalidArgument(c, 'name', 'name is required and must be a non-empty string');
    }
    if (
      body.owner_id !== undefined &&
      body.owner_id !== null &&
      (typeof body.owner_id !== 'string' || body.owner_id.trim() === '')
    ) {
      return invalidArgument(c, 'owner_id', 'owner_id is required and must be a non-empty string');
    }
    if (
      body.overview_document_id !== undefined &&
      body.overview_document_id !== null &&
      typeof body.overview_document_id !== 'string'
    ) {
      return invalidArgument(c, 'overview_document_id', 'overview_document_id must be a string');
    }
    if (body.repo_url !== undefined && body.repo_url !== null) {
      if (typeof body.repo_url !== 'string' || !isValidRepoUrl(body.repo_url)) {
        return invalidArgument(c, 'repo_url', 'repo_url must be a string');
      }
    }
    if (body.folder_path !== undefined && body.folder_path !== null) {
      if (
        typeof body.folder_path !== 'string' ||
        (!isValidFolderPath(body.folder_path) && !isValidRegisteredRepoRoot(body.folder_path))
      ) {
        return invalidArgument(c, 'folder_path', 'folder_path must be a string');
      }
    }

    const contentPatch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.owner_id !== undefined ? { ownerId: body.owner_id } : {}),
      ...(body.overview_document_id !== undefined
        ? { overviewDocumentId: body.overview_document_id }
        : {}),
      ...(body.repo_url !== undefined ? { repoUrl: body.repo_url } : {}),
      ...(body.folder_path !== undefined ? { folderPath: body.folder_path } : {}),
    };
    const hasContentPatch = Object.keys(contentPatch).length > 0;

    // Move and content edit are different permission axes. Reject a mixed PATCH
    // before any write so a failed content update cannot leave a half-applied move.
    if (body.workspace_id !== undefined && hasContentPatch) {
      return invalidArgument(c, 'workspace_id', 'workspace_id is required');
    }

    if (body.workspace_id !== undefined && body.workspace_id !== null) {
      if (typeof body.workspace_id !== 'string' || body.workspace_id.trim() === '') {
        return invalidArgument(c, 'workspace_id', 'workspace_id is required and must be a non-empty string');
      }
      try {
        const moved = await projectService.moveProjectToWorkspace(
          c.req.param('id'),
          body.workspace_id,
        );
        if (!moved) {
          return c.json({ error: 'not_found' }, 404);
        }
        return c.json(moved);
      } catch (error) {
        if (error instanceof WorkspaceNotFoundError) {
          return c.json({ error: 'not_found' }, 404);
        }
        throw error;
      }
    }

    try {
      const project = await projectService.update(c.req.param('id'), contentPatch);
      if (!project) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(project);
    } catch (error) {
      if (error instanceof InvalidOverviewDocumentError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
  });

  router.delete('/projects/:id', async (c) => {
    const deleted = await projectService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  router.post('/projects/:id/tasks', async (c) => {
    const body = await c.req.json<{
      label?: string;
      status?: string;
      kind?: string;
      priority?: string | null;
      lane?: string | null;
      severity?: string | null;
      description?: string | null;
      x?: number;
      y?: number;
      assignee?: string | null;
      due_date?: string | null;
      goal_id?: string;
      tags?: unknown;
    }>();

    if (typeof body.label !== 'string' || body.label.trim() === '') {
      return invalidArgument(c, 'label', 'label is required and must be a non-empty string');
    }

    if (body.status !== undefined && !isTaskStatus(body.status)) {
      return invalidArgument(c, 'status', 'status must be a valid task status');
    }

    if (body.kind !== undefined && !isTaskKind(body.kind)) {
      return invalidArgument(c, 'kind', 'kind must be a valid task kind');
    }

    if (
      body.priority !== undefined &&
      body.priority !== null &&
      !isTaskPriority(body.priority)
    ) {
      return invalidArgument(c, 'priority', 'priority must be a valid task priority');
    }

    if (body.lane !== undefined && body.lane !== null && !isTaskLane(body.lane)) {
      return invalidArgument(c, 'lane', 'lane must be a valid task lane');
    }
    if (body.severity !== undefined && body.severity !== null && !isTaskSeverity(body.severity)) {
      return invalidArgument(c, 'severity', 'severity must be a valid task severity');
    }

    if (body.tags !== undefined && !isStringArray(body.tags)) {
      return invalidArgument(c, 'tags', 'tags must be an array of strings');
    }

    let dueDate: Date | null | undefined;
    if (body.due_date !== undefined && body.due_date !== null) {
      dueDate = new Date(body.due_date);
      if (Number.isNaN(dueDate.getTime())) {
        return invalidArgument(c, 'due_date', 'due_date must be a valid date');
      }
    } else if (body.due_date === null) {
      dueDate = null;
    }

    try {
      const task = await taskService.create(c.req.param('id'), {
        label: body.label,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.lane !== undefined ? { lane: body.lane } : {}),
        ...(body.severity !== undefined ? { severity: body.severity } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.x !== undefined ? { x: body.x } : {}),
        ...(body.y !== undefined ? { y: body.y } : {}),
        ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(body.goal_id !== undefined ? { goalId: body.goal_id } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      });

      if (!task) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(task, 201);
    } catch (error) {
      if (
        error instanceof InvalidTaskStatusError ||
        error instanceof InvalidTaskKindError ||
        error instanceof InvalidTaskPriorityError ||
        error instanceof InvalidTaskLaneError ||
        error instanceof InvalidTaskSeverityError ||
        error instanceof InvalidTagError ||
        error instanceof InvalidGoalReferenceError ||
        error instanceof UnstoredColumnError
      ) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/projects/:id/tasks', async (c) => {
    try {
      const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
      if (pagination === 'invalid') {
        return invalidRequest(c, 'limit and offset must be non-negative integers');
      }
      const status = c.req.query('status');
      const kind = c.req.query('kind');
      const priority = c.req.query('priority');
      const lane = c.req.query('lane');
      const severity = c.req.query('severity');
      // Repeated ?tag= params filter with OR semantics (task matches if it has
      // ANY of the given tags).
      const tags = c.req.queries('tag');
      const tasks = await taskService.listByProject(
        c.req.param('id'),
        {
          status,
          kind,
          priority,
          lane,
          severity,
          ...(tags !== undefined && tags.length > 0 ? { tags } : {}),
        },
        pagination,
      );
      if (!tasks) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(tasks);
    } catch (error) {
      if (
        error instanceof InvalidTaskStatusError ||
        error instanceof InvalidTaskKindError ||
        error instanceof InvalidTaskPriorityError ||
        error instanceof InvalidTagError
      ) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/projects/:id/next-task', async (c) => {
    const result = await taskService.nextActionable(c.req.param('id'));
    if (!result) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(result);
  });

  router.post('/projects/:id/export', async (c) => {
    let body: { format?: unknown; view?: unknown };
    try {
      body = await c.req.json<{ format?: unknown; view?: unknown }>();
    } catch {
      return invalidRequest(c, 'request body must be valid JSON');
    }
    if (body.view === undefined) {
      return invalidArgument(c, 'view', 'view is required');
    }
    try {
      const result = await exportService.exportView(c.req.param('id'), {
        format: body.format,
        view: body.view,
      });
      if (result === undefined) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.body(new Uint8Array(result.body), 200, {
        'Content-Type': result.contentType,
        'Content-Disposition': result.contentDisposition,
      });
    } catch (error) {
      if (error instanceof InvalidExportRequestError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
  });

  return router;
}
