import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { createAuthMiddleware } from './auth.js';
import { healthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createTagsRouter } from './routes/tags.js';
import { createCanvasRouter } from './routes/canvas.js';
import { createCommentsRouter } from './routes/comments.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createFilesRouter } from './routes/files.js';
import { createFoldersRouter } from './routes/folders.js';
import { createNotesRouter } from './routes/notes.js';
import type { EventBus } from './events.js';
import { createEventsRouter } from './routes/events.js';
import { createTokensRouter } from './routes/tokens.js';
import { createAgentRunsRouter } from './routes/agent-runs.js';
import { createGoalsRouter } from './routes/goals.js';
import { createSubmissionsRouter } from './routes/submissions.js';
import { mountStatic } from './static.js';
import { createServices, type Services } from './services/index.js';

export type AppDeps = {
  db: Db;
  eventBus?: EventBus;
  services?: Services;
  mcp?: Hono;
  authPassword?: string;
};

export function createApp(deps: AppDeps): Hono {
  const services = deps.services ?? createServices({ db: deps.db, eventBus: deps.eventBus });
  const {
    eventBus,
    projectService,
    goalService,
    taskService,
    tagService,
    canvasService,
    documentService,
    folderService,
    noteService,
    commentService,
    agentRunService,
    tokenService,
    syncService,
    fileService,
  } = services;

  const app = new Hono();

  if (deps.authPassword !== undefined && deps.authPassword.length > 0) {
    app.use('*', createAuthMiddleware(deps.authPassword));
  }

  app.route('/api/v1', healthRouter);
  app.route('/api/v1', createProjectsRouter(projectService, taskService));
  app.route('/api/v1', createGoalsRouter(goalService));
  app.route('/api/v1', createTasksRouter(taskService));
  app.route('/api/v1', createTagsRouter(tagService));
  app.route('/api/v1', createCanvasRouter(canvasService));
  app.route('/api/v1', createDocumentsRouter(documentService));
  app.route('/api/v1', createFilesRouter(fileService));
  app.route('/api/v1', createFoldersRouter(folderService));
  app.route('/api/v1', createNotesRouter(noteService));
  app.route('/api/v1', createCommentsRouter(commentService));
  app.route('/api/v1', createTokensRouter(tokenService));
  app.route('/api/v1', createAgentRunsRouter(agentRunService));
  app.route('/api/v1', createSubmissionsRouter(syncService, projectService));
  app.route('/api/v1', createEventsRouter(eventBus));

  // Mount the MCP router BEFORE the static/SPA handler. The MCP transport uses
  // GET /mcp/ for its server->client SSE stream; if the SPA catch-all (app.get('*'))
  // is registered first it shadows that GET and the stream never reaches the
  // transport, breaking reconnect. The MCP router must own every method on /mcp/*.
  if (deps.mcp) {
    app.route('/mcp', deps.mcp);
  }

  mountStatic(app);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
