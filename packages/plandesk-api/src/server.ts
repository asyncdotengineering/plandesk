import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import {
  createAuthMiddleware,
  createOrgAuthMiddleware,
  createWriteGuardMiddleware,
} from './auth.js';
import { healthRouter } from './routes/health.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createTagsRouter } from './routes/tags.js';
import { createCanvasRouter } from './routes/canvas.js';
import { createCommentsRouter } from './routes/comments.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createArtifactsRouter } from './routes/artifacts.js';
import { createFilesRouter } from './routes/files.js';
import { createFoldersRouter } from './routes/folders.js';
import { createNotesRouter } from './routes/notes.js';
import { createSharesRouter } from './routes/shares.js';
import { createTokensRouter } from './routes/tokens.js';
import { createAgentRunsRouter } from './routes/agent-runs.js';
import { createGoalsRouter } from './routes/goals.js';
import { createSubmissionsRouter } from './routes/submissions.js';
import { createOrgsRouter } from './routes/orgs.js';
import { createServices, type Services } from './services/index.js';
import { ProjectNotInOrgError } from './services/scope.js';
import { ReadOnlyTokenError } from './auth-context.js';

export type AppDeps = {
  db: Db;
  services?: Services;
  mcp?: Hono;
  authPassword?: string;
  /** Server bind host — loopback default-org only when this is loopback. Default 127.0.0.1. */
  bindHost?: string;
};

export function createApp(deps: AppDeps): Hono {
  const services = deps.services ?? createServices({ db: deps.db });
  const {
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
    artifactService,
    shareService,
  } = services;

  const bindHost = deps.bindHost ?? '127.0.0.1';
  const app = new Hono();

  // Always-on org resolution (token or loopback single-org).
  app.use('*', createOrgAuthMiddleware({ db: deps.db, bindHost }));
  app.use('*', createWriteGuardMiddleware());

  if (deps.authPassword !== undefined && deps.authPassword.length > 0) {
    app.use('*', createAuthMiddleware(deps.authPassword));
  }

  app.onError((err, c) => {
    if (err instanceof ProjectNotInOrgError) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (err instanceof ReadOnlyTokenError) {
      return c.json({ error: 'forbidden' }, 403);
    }
    throw err;
  });

  app.route('/api/v1', healthRouter);
  app.route('/api/v1', createOrgsRouter(deps.db));
  app.route('/api/v1', createProjectsRouter(projectService, taskService));
  app.route('/api/v1', createGoalsRouter(goalService));
  app.route('/api/v1', createTasksRouter(taskService));
  app.route('/api/v1', createTagsRouter(tagService));
  app.route('/api/v1', createCanvasRouter(canvasService));
  app.route('/api/v1', createDocumentsRouter(documentService));
  app.route('/api/v1', createFilesRouter(fileService));
  app.route('/api/v1', createArtifactsRouter(artifactService));
  app.route('/api/v1', createFoldersRouter(folderService));
  app.route('/api/v1', createNotesRouter(noteService));
  app.route('/api/v1', createSharesRouter(shareService));
  app.route('/api/v1', createCommentsRouter(commentService));
  app.route('/api/v1', createTokensRouter(tokenService));
  app.route('/api/v1', createAgentRunsRouter(agentRunService));
  app.route('/api/v1', createSubmissionsRouter(syncService, projectService));

  // Mount the MCP router BEFORE the static/SPA handler. The MCP transport uses
  // GET /mcp/ for its server->client SSE stream; if the SPA catch-all (app.get('*'))
  // is registered first it shadows that GET and the stream never reaches the
  // transport, breaking reconnect. The MCP router must own every method on /mcp/*.
  if (deps.mcp) {
    app.route('/mcp', deps.mcp);
  }

  // SPA static files are NOT mounted here. Node mounts them via `mountStatic`
  // in the serve entry; Workers/Vercel serve the SPA through platform assets.
  // Keeping static out of createApp prevents node:fs and @hono/node-server
  // from entering the edge bundle graph.

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
