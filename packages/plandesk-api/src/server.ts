import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { healthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createCanvasRouter } from './routes/canvas.js';
import { createDocumentsRouter } from './routes/documents.js';
import type { EventBus } from './events.js';
import { createEventsRouter } from './routes/events.js';
import { createTokensRouter } from './routes/tokens.js';
import { mountStatic } from './static.js';
import { createServices, type Services } from './services/index.js';

export type AppDeps = {
  db: Db;
  eventBus?: EventBus;
  services?: Services;
  mcp?: Hono;
};

export function createApp(deps: AppDeps): Hono {
  const services = deps.services ?? createServices({ db: deps.db, eventBus: deps.eventBus });
  const { eventBus, projectService, taskService, canvasService, documentService, tokenService } =
    services;

  const app = new Hono();

  app.route('/api/v1', healthRouter);
  app.route('/api/v1', createProjectsRouter(projectService, taskService));
  app.route('/api/v1', createTasksRouter(taskService));
  app.route('/api/v1', createCanvasRouter(canvasService));
  app.route('/api/v1', createDocumentsRouter(documentService));
  app.route('/api/v1', createTokensRouter(tokenService));
  app.route('/api/v1', createEventsRouter(eventBus));
  mountStatic(app);

  if (deps.mcp) {
    app.route('/mcp', deps.mcp);
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
