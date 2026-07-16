export { createApp, type AppDeps } from './server.js';
export {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthDeps,
  type BetterAuthInstance,
} from './better-auth.js';
export { ensureLocalBetterAuthOrganization } from './identity.js';
export {
  createAuthMiddleware,
  createOrgAuthMiddleware,
  createWriteGuardMiddleware,
  isLoopbackBind,
  isPublicAuthPath,
  type OrgAuthOptions,
} from './auth.js';
export {
  authorizeUrl,
  githubConfigFromEnv,
  resolveGithubIdentity,
  userRefFromGithubId,
  GithubOAuthError,
  type FetchLike,
  type GithubConfig,
  type GithubEnv,
  type GithubIdentity,
} from './github.js';
export {
  SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  readSessionCookie,
  setSessionCookie,
  clearSessionCookie,
} from './session.js';
export { createAuthRouter, type AuthRouterDeps } from './routes/auth.js';
export {
  runWithAuthContext,
  tryGetAuthContext,
  getAuthContext,
  ReadOnlyTokenError,
  type AuthContext,
} from './auth-context.js';
export {
  effectivePermission,
  requireRole,
  hasAtLeast,
  InsufficientPermissionError,
  ROLE_RANK,
} from './permissions.js';
export { USER_REF_HEADER } from './auth.js';
export { healthRouter } from './routes/health.js';
export { mountStatic } from './static.js';
export { createS3Adapter, type S3AdapterConfig } from './storage/s3.js';
export type { StorageAdapter } from './storage/adapter.js';
export { createServices, type Services, type ServicesDeps } from './services/index.js';
export { assertProjectInOrg, ProjectNotInOrgError } from './services/scope.js';
export type { ProjectService } from './services/projects.js';
export type { GoalService, VerificationEvidence } from './services/goals.js';
export {
  GoalCompletionBlockedError,
  GoalVerificationRequiredError,
  InvalidGoalTransitionError,
  InvalidVerificationSurfaceError,
} from './services/goals.js';
export type { TaskService } from './services/tasks.js';
export { InvalidGoalReferenceError } from './services/tasks.js';
export type { TagService } from './services/tags.js';
export type { CanvasService } from './services/canvas.js';
export type { DocumentService } from './services/documents.js';
export type { FolderService } from './services/folders.js';
export type { NoteService } from './services/notes.js';
export type { FileService } from './services/files.js';
export type { ArtifactService } from './services/artifacts.js';
export type { CommentService } from './services/comments.js';
export type { AgentRunService } from './services/agent-runs.js';
export { InvalidDocumentError } from './services/documents.js';
export { InvalidFolderError } from './services/folders.js';
export { InvalidNoteError } from './services/notes.js';
export { InvalidArtifactError } from './services/artifacts.js';
export { InvalidTagError } from './services/tags.js';
export { InvalidCommentError } from './services/comments.js';
export { InvalidCanvasError } from './services/canvas.js';
export { InvalidAgentRunError } from './services/agent-runs.js';
export { InvalidScaffoldError } from './services/projects.js';
export { InvalidShareError, type ShareService } from './services/share.js';
export {
  InvalidTriageError,
  InvalidTriageInputError,
  SyncUnavailableError,
  SyncUnauthorizedError,
  type SyncRemote,
  type SyncService,
} from './services/sync.js';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');

export const version = (): string => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};
