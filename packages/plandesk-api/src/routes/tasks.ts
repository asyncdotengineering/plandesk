import { Hono } from 'hono';
import { InvalidTaskStatusError, isTaskStatus } from '@plandesk/db';
import type { TaskService } from '../services/tasks.js';

export function createTasksRouter(taskService: TaskService): Hono {
  const router = new Hono();

  router.patch('/tasks/:id', async (c) => {
    const body = await c.req.json<{
      status?: string;
      label?: string;
      description?: string | null;
      x?: number;
      y?: number;
    }>();

    if (body.status !== undefined && !isTaskStatus(body.status)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const task = taskService.update(c.req.param('id'), {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.x !== undefined ? { x: body.x } : {}),
        ...(body.y !== undefined ? { y: body.y } : {}),
      });

      if (!task) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(task);
    } catch (error) {
      if (error instanceof InvalidTaskStatusError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  return router;
}
