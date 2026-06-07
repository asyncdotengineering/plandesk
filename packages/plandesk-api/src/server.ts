import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { healthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createProjectService } from './services/projects.js';
import { createTaskService } from './services/tasks.js';
import { mountStatic } from './static.js';

export type AppDeps = {
  db: Db;
};

export function createApp(deps: AppDeps): Hono {
  const projectService = createProjectService({ db: deps.db });
  const taskService = createTaskService({ db: deps.db });

  const app = new Hono();

  app.route('/api/v1', healthRouter);
  app.route('/api/v1', createProjectsRouter(projectService, taskService));
  app.route('/api/v1', createTasksRouter(taskService));
  mountStatic(app);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
