export { createApp, type AppDeps } from './server.js';
export { createAuthMiddleware } from './auth.js';
export { healthRouter } from './routes/health.js';
export { mountStatic } from './static.js';
export { createServices, type Services, type ServicesDeps } from './services/index.js';
export { createEventBus, type EventBus, type PlankDeskEvent } from './events.js';
export type { ProjectService } from './services/projects.js';
export type { TaskService } from './services/tasks.js';
export type { CanvasService } from './services/canvas.js';
export type { DocumentService } from './services/documents.js';
export type { CommentService } from './services/comments.js';
export type { AgentRunService } from './services/agent-runs.js';
export { InvalidDocumentError } from './services/documents.js';
export { InvalidCommentError } from './services/comments.js';
export { InvalidCanvasError } from './services/canvas.js';
export { InvalidAgentRunError } from './services/agent-runs.js';
export { InvalidScaffoldError } from './services/projects.js';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');

export const version = (): string => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};
