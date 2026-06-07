import { Hono } from 'hono';
import { InvalidTaskStatusError } from '@plandesk/db';
import type { ProjectService } from '../services/projects.js';
import type { TaskService } from '../services/tasks.js';

export function createProjectsRouter(
  projectService: ProjectService,
  taskService: TaskService,
): Hono {
  const router = new Hono();

  router.get('/projects', (c) => c.json(projectService.list()));

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

  router.get('/projects/:id/tasks', (c) => {
    try {
      const status = c.req.query('status');
      const tasks = taskService.listByProject(c.req.param('id'), { status });
      if (!tasks) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(tasks);
    } catch (error) {
      if (error instanceof InvalidTaskStatusError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  return router;
}
