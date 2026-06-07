import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { healthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createCanvasRouter } from './routes/canvas.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createProjectService } from './services/projects.js';
import { createTaskService } from './services/tasks.js';
import { createCanvasService } from './services/canvas.js';
import { createDocumentService } from './services/documents.js';
import { mountStatic } from './static.js';

export type AppDeps = {
  db: Db;
};

export function createApp(deps: AppDeps): Hono {
  const projectService = createProjectService({ db: deps.db });
  const taskService = createTaskService({ db: deps.db });
  const canvasService = createCanvasService({ db: deps.db });
  const documentService = createDocumentService({ db: deps.db });

  const app = new Hono();

  app.route('/api/v1', healthRouter);
  app.route('/api/v1', createProjectsRouter(projectService, taskService));
  app.route('/api/v1', createTasksRouter(taskService));
  app.route('/api/v1', createCanvasRouter(canvasService));
  app.route('/api/v1', createDocumentsRouter(documentService));
  mountStatic(app);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
