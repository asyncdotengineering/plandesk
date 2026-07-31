import { Hono } from 'hono';
import {
  InvalidTaskKindError,
  InvalidTaskPriorityError,
  InvalidTaskStatusError,
  isTaskKind,
  isTaskPriority,
  isTaskStatus,
  isValidFolderPath,
  isValidRepoUrl,
} from '@plandesk/db';
import type { ProjectService } from '../services/projects.js';
import { InvalidGoalReferenceError, type TaskService } from '../services/tasks.js';
import { InvalidTagError } from '../services/tags.js';
import { isStringArray } from './tasks.js';
import { parsePaginationParams } from '../serialize.js';
import { WorkspaceNotFoundError } from '../services/scope.js';

export function createProjectsRouter(
  projectService: ProjectService,
  taskService: TaskService,
): Hono {
  const router = new Hono();

  router.get('/projects', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    return c.json(await projectService.list(pagination));
  });

  router.post('/projects', async (c) => {
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      repo_url?: string | null;
      folder_path?: string | null;
      workspace_id?: string;
    }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.repo_url !== undefined && body.repo_url !== null) {
      if (typeof body.repo_url !== 'string' || !isValidRepoUrl(body.repo_url)) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
    }
    if (body.folder_path !== undefined && body.folder_path !== null) {
      if (typeof body.folder_path !== 'string' || !isValidFolderPath(body.folder_path)) {
        return c.json({ error: 'invalid_argument' }, 400);
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
        ...(body.repo_url !== undefined ? { repoUrl: body.repo_url } : {}),
        ...(body.folder_path !== undefined ? { folderPath: body.folder_path } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: 'not_found' }, 404);
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
      repo_url?: string | null;
      folder_path?: string | null;
      workspace_id?: string | null;
    }>();
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.repo_url !== undefined && body.repo_url !== null) {
      if (typeof body.repo_url !== 'string' || !isValidRepoUrl(body.repo_url)) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
    }
    if (body.folder_path !== undefined && body.folder_path !== null) {
      if (typeof body.folder_path !== 'string' || !isValidFolderPath(body.folder_path)) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
    }

    const contentPatch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.repo_url !== undefined ? { repoUrl: body.repo_url } : {}),
      ...(body.folder_path !== undefined ? { folderPath: body.folder_path } : {}),
    };
    const hasContentPatch = Object.keys(contentPatch).length > 0;

    // Move and content edit are different permission axes. Reject a mixed PATCH
    // before any write so a failed content update cannot leave a half-applied move.
    if (body.workspace_id !== undefined && hasContentPatch) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.workspace_id !== undefined && body.workspace_id !== null) {
      if (typeof body.workspace_id !== 'string' || body.workspace_id.trim() === '') {
        return c.json({ error: 'invalid_argument' }, 400);
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

    const project = await projectService.update(c.req.param('id'), contentPatch);
    if (!project) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(project);
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
      description?: string | null;
      x?: number;
      y?: number;
      assignee?: string | null;
      due_date?: string | null;
      goal_id?: string;
      tags?: unknown;
    }>();

    if (typeof body.label !== 'string' || body.label.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.status !== undefined && !isTaskStatus(body.status)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.kind !== undefined && !isTaskKind(body.kind)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (
      body.priority !== undefined &&
      body.priority !== null &&
      !isTaskPriority(body.priority)
    ) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.tags !== undefined && !isStringArray(body.tags)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    let dueDate: Date | null | undefined;
    if (body.due_date !== undefined && body.due_date !== null) {
      dueDate = new Date(body.due_date);
      if (Number.isNaN(dueDate.getTime())) {
        return c.json({ error: 'invalid_argument' }, 400);
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
        error instanceof InvalidTagError ||
        error instanceof InvalidGoalReferenceError
      ) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/projects/:id/tasks', async (c) => {
    try {
      const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
      if (pagination === 'invalid') {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      const status = c.req.query('status');
      const kind = c.req.query('kind');
      const priority = c.req.query('priority');
      // Repeated ?tag= params filter with OR semantics (task matches if it has
      // ANY of the given tags).
      const tags = c.req.queries('tag');
      const tasks = await taskService.listByProject(
        c.req.param('id'),
        {
          status,
          kind,
          priority,
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
        return c.json({ error: 'invalid_argument' }, 400);
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

  return router;
}
