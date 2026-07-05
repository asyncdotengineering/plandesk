import { Hono } from 'hono';
import { InvalidTaskStatusError, isTaskStatus } from '@plandesk/db';
import type { ProjectService } from '../services/projects.js';
import { InvalidGoalReferenceError, type TaskService } from '../services/tasks.js';
import { InvalidTagError } from '../services/tags.js';
import { isStringArray } from './tasks.js';
import { parsePaginationParams } from '../serialize.js';

export function createProjectsRouter(
  projectService: ProjectService,
  taskService: TaskService,
): Hono {
  const router = new Hono();

  router.get('/projects', (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    return c.json(projectService.list(pagination));
  });

  router.post('/projects', async (c) => {
    const body = await c.req.json<{ name?: string; description?: string | null }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const project = projectService.create({
      name: body.name,
      description: body.description,
    });
    return c.json(project, 201);
  });

  router.get('/projects/:id', (c) => {
    const project = projectService.get(c.req.param('id'));
    if (!project) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(project);
  });

  router.patch('/projects/:id', async (c) => {
    const body = await c.req.json<{ name?: string; description?: string | null }>();
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const project = projectService.update(c.req.param('id'), {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
    if (!project) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(project);
  });

  router.delete('/projects/:id', (c) => {
    const deleted = projectService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  router.post('/projects/:id/tasks', async (c) => {
    const body = await c.req.json<{
      label?: string;
      status?: string;
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
      const task = taskService.create(c.req.param('id'), {
        label: body.label,
        ...(body.status !== undefined ? { status: body.status } : {}),
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
        error instanceof InvalidTagError ||
        error instanceof InvalidGoalReferenceError
      ) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/projects/:id/tasks', (c) => {
    try {
      const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
      if (pagination === 'invalid') {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      const status = c.req.query('status');
      // Repeated ?tag= params filter with OR semantics (task matches if it has
      // ANY of the given tags).
      const tags = c.req.queries('tag');
      const tasks = taskService.listByProject(
        c.req.param('id'),
        { status, ...(tags !== undefined && tags.length > 0 ? { tags } : {}) },
        pagination,
      );
      if (!tasks) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(tasks);
    } catch (error) {
      if (error instanceof InvalidTaskStatusError || error instanceof InvalidTagError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/projects/:id/next-task', (c) => {
    const result = taskService.nextActionable(c.req.param('id'));
    if (!result) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(result);
  });

  return router;
}
