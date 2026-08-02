import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import {
  createAuthMiddleware,
  createOrgAuthMiddleware,
  createWriteGuardMiddleware,
} from './auth.js';
import { createHealthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import type { GithubConfig } from './github.js';
import { createBetterAuth } from './better-auth.js';
import type { BetterAuthInstance } from './better-auth.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createTagsRouter } from './routes/tags.js';
import { createViewsRouter } from './routes/views.js';
import { createCanvasRouter } from './routes/canvas.js';
import { createCommentsRouter } from './routes/comments.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createArtifactsRouter } from './routes/artifacts.js';
import { createFilesRouter } from './routes/files.js';
import { createFoldersRouter } from './routes/folders.js';
import { createPrototypesRouter } from './routes/prototypes.js';
import { createNotesRouter } from './routes/notes.js';
import { createSharesRouter } from './routes/shares.js';
import { createAgentRunsRouter } from './routes/agent-runs.js';
import { createGoalsRouter } from './routes/goals.js';
import { createSubmissionsRouter } from './routes/submissions.js';
import { createOrgsRouter } from './routes/orgs.js';
import { createRevisionsRouter } from './routes/revisions.js';
import { createServices, type Services } from './services/index.js';
import { ProjectNotInOrgError, WorkspaceNotFoundError } from './services/scope.js';
import { ReadOnlyTokenError } from './auth-context.js';
import { PermissionDeniedError } from './permissions.js';

export type AppDeps = {
  db: Db;
  services?: Services;
  mcp?: Hono;
  authPassword?: string;
  /** Server bind host — loopback default-org only when this is loopback. Default 127.0.0.1. */
  bindHost?: string;
  /**
   * GitHub app for better-auth social sign-in. Omit it and the instance simply
   * has no GitHub sign-in; /auth/methods reports githubEnabled:false.
   * Self-hosting must never require registering an app (REQ-20).
   */
  github?: GithubConfig;
  /**
   * better-auth (GitHub sign-in + session + apiKey). Omit and /api/auth/* 404s;
   * when set, org middleware recognizes better-auth session cookies and API keys.
   */
  betterAuth?: { secret: string; baseURL: string };
  /** Reuse a better-auth instance owned by an edge entry across requests. */
  betterAuthInstance?: BetterAuthInstance;
  /** Node-local board path, surfaced on /api/v1/health for identity checks (REQ-A3a). */
  dataDir?: string;
};

export function createApp(deps: AppDeps): Hono {
  const bindHost = deps.bindHost ?? '127.0.0.1';

  // Create better-auth before services so workspace resolution is available
  // to the project service (REQ-6).
  const betterAuthInstance =
    deps.betterAuthInstance ??
    (deps.betterAuth !== undefined
      ? createBetterAuth({
          client: deps.db.$client,
          db: deps.db,
          secret: deps.betterAuth.secret,
          baseURL: deps.betterAuth.baseURL,
          github: deps.github,
        })
      : undefined);

  const services =
    deps.services ?? createServices({ db: deps.db, auth: betterAuthInstance });
  const {
    projectService,
    goalService,
    taskService,
    tagService,
    viewService,
    projectExportService,
    canvasService,
    documentService,
    folderService,
    prototypeService,
    noteService,
    commentService,
    agentRunService,
    syncService,
    fileService,
    artifactService,
    shareService,
    revisionService,
  } = services;

  const app = new Hono();

  // Always-on org resolution (better-auth apiKey/session, loopback, or guest).
  app.use(
    '*',
    createOrgAuthMiddleware({
      db: deps.db,
      bindHost,
      betterAuth: betterAuthInstance,
    }),
  );
  app.use('*', createWriteGuardMiddleware());

  if (deps.authPassword !== undefined && deps.authPassword.length > 0) {
    app.use('*', createAuthMiddleware(deps.authPassword));
  }

  app.onError((err, c) => {
    if (err instanceof ProjectNotInOrgError) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (err instanceof WorkspaceNotFoundError) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (err instanceof ReadOnlyTokenError || err instanceof PermissionDeniedError) {
      return c.json({ error: 'forbidden' }, 403);
    }
    throw err;
  });

  app.route('/api/v1', createHealthRouter(deps.dataDir));
  app.route(
    '/api/v1',
    createAuthRouter({
      db: deps.db,
      github: deps.github,
      betterAuth: betterAuthInstance,
    }),
  );
  app.route(
    '/api/v1',
    createOrgsRouter(deps.db, {
      betterAuth: betterAuthInstance,
      baseURL: deps.betterAuth?.baseURL,
    }),
  );
  app.route(
    '/api/v1',
    createProjectsRouter(projectService, taskService, projectExportService),
  );
  app.route('/api/v1', createGoalsRouter(goalService));
  app.route('/api/v1', createTasksRouter(taskService));
  app.route('/api/v1', createTagsRouter(tagService));
  app.route('/api/v1', createViewsRouter(viewService));
  app.route('/api/v1', createCanvasRouter(canvasService));
  app.route('/api/v1', createDocumentsRouter(documentService));
  app.route('/api/v1', createFilesRouter(fileService));
  app.route('/api/v1', createArtifactsRouter(artifactService));
  app.route('/api/v1', createFoldersRouter(folderService));
  app.route('/api/v1', createPrototypesRouter(prototypeService));
  app.route('/api/v1', createNotesRouter(noteService));
  app.route('/api/v1', createSharesRouter(shareService));
  app.route('/api/v1', createCommentsRouter(commentService));
  app.route('/api/v1', createAgentRunsRouter(agentRunService));
  app.route('/api/v1', createSubmissionsRouter(syncService, projectService));
  app.route('/api/v1', createRevisionsRouter(revisionService));

  // Mount the MCP router BEFORE the static/SPA handler. The MCP transport uses
  // GET /mcp/ for its server->client SSE stream; if the SPA catch-all (app.get('*'))
  // is registered first it shadows that GET and the stream never reaches the
  // transport, breaking reconnect. The MCP router must own every method on /mcp/*.
  if (deps.mcp) {
    app.route('/mcp', deps.mcp);
  }

  // Mounted at /api/auth/*, one segment away from the existing /api/v1/auth/*
  // (routes/auth.ts) so it can never shadow it. /api/auth/* is public so a
  // stranger can reach sign-in without a plandesk credential first (BA4a).
  if (betterAuthInstance) {
    app.on(['GET', 'POST'], '/api/auth/*', (c) => betterAuthInstance.handler(c.req.raw));
  }

  // SPA static files are NOT mounted here. Node mounts them via `mountStatic`
  // in the serve entry; Workers/Vercel serve the SPA through platform assets.
  // Keeping static out of createApp prevents node:fs and @hono/node-server
  // from entering the edge bundle graph.

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
