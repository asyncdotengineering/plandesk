export { createApp, type AppDeps } from './server.js';
export {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthDeps,
  type BetterAuthInstance,
} from './better-auth.js';
export {
  backfillDefaultTeams,
  backfillProjectWorkspaces,
  createTeamForOrg,
  ensureDefaultTeamForOrg,
  ensureLocalBetterAuthOrganization,
  listTeamsForOrg,
} from './identity.js';
export {
  createAuthMiddleware,
  createOrgAuthMiddleware,
  createWriteGuardMiddleware,
  isLoopbackBind,
  isPublicAuthPath,
  isInvitationAcceptPath,
  type OrgAuthOptions,
} from './auth.js';
export {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  ensureShellOwner,
  invitationClaimUrl,
  isAuthApiError,
  isInvitationRole,
  mintOwnerInvitation,
  mintSessionCookieHeader,
  removeOrganizationMember,
  updateOrganizationMemberRole,
  INVITATION_ROLES,
  type InvitationRole,
} from './invitations.js';
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
export { GUEST_SESSION_COOKIE, readGuestSessionCookie } from './session.js';
export { createAuthRouter, type AuthRouterDeps } from './routes/auth.js';
export {
  runWithAuthContext,
  tryGetAuthContext,
  getAuthContext,
  getOrgAuthContext,
  ReadOnlyTokenError,
  type AuthContext,
} from './auth-context.js';
export {
  serializeActor,
  parseActor,
  resolveWriteActorFromAuthContext,
  WriteActorUnresolvedError,
  InvalidActorSerializationError,
  type WriteActor,
} from './write-actor.js';
export { resolveWriteActor, type OrgScopedDeps } from './services/org-scope.js';
export {
  applyAgentKeyPermissionCeiling,
  createScopedAgentKey,
  createWorkspaceScopedAgentKey,
  createOrgOwnerKey,
  verifyBetterAuthApiKey,
  DEFAULT_AGENT_KEY_PERMISSIONS,
  DEFAULT_OWNER_KEY_PERMISSIONS,
  AGENT_FORBIDDEN_RESOURCES,
  type ApiKeyKind,
  type CreateScopedAgentKeyInput,
  type CreatedScopedAgentKey,
  type CreateWorkspaceScopedAgentKeyInput,
  type CreatedWorkspaceScopedAgentKey,
  type CreateOrgOwnerKeyInput,
  type CreatedOrgOwnerKey,
  type VerifiedApiKey,
} from './agent-keys.js';
export {
  requirePermission,
  hasPermission,
  hasAnyWritePermission,
  orgRoleToPermissionSet,
  PermissionDeniedError,
  type PermissionSet,
} from './permissions.js';
export { healthRouter } from './routes/health.js';
export { mountStatic } from './static.js';
// Hosted (non-loopback) entry helpers — used by the deployment composition root
// (@plandesk/worker), which wires this app together with the MCP app.
export {
  hostedMisconfigResponse,
  resolveHostedBetterAuth,
  type HostedAuthEnv,
} from './hosted-auth.js';
export { createS3Adapter, type S3AdapterConfig } from './storage/s3.js';
export { createR2Adapter, type R2BucketLike } from './storage/r2.js';
export type { StorageAdapter } from './storage/adapter.js';
export { createServices, type Services, type ServicesDeps } from './services/index.js';
export {
  maxRevisionsFromEnv,
  captureRevision,
  type MaxRevisionsEnv,
} from './services/revision-capture.js';
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
export { InvalidGoalReferenceError, InvalidCommitRefsError } from './services/tasks.js';
export type { TagService } from './services/tags.js';
export type { ViewService } from './services/views.js';
export type { CanvasService } from './services/canvas.js';
export type { DocumentService } from './services/documents.js';
export type { FolderService } from './services/folders.js';
export type { NoteService } from './services/notes.js';
export type { FileService } from './services/files.js';
export type { ArtifactService } from './services/artifacts.js';
export type { CommentService } from './services/comments.js';
export type { AgentRunService } from './services/agent-runs.js';
export {
  convertDocumentBody,
  ensureHtmlBody,
  type ConvertDocumentBodyOptions,
  type ConvertDocumentBodyResult,
  type WikiLinkResolved,
  type WikiLinkResolver,
} from './markdown.js';
export { InvalidDocumentError } from './services/documents.js';
export { InvalidFolderError } from './services/folders.js';
export { InvalidNoteError } from './services/notes.js';
export { InvalidArtifactError } from './services/artifacts.js';
export { InvalidTagError } from './services/tags.js';
export { InvalidViewError } from './services/views.js';
export { InvalidCommentError } from './services/comments.js';
export { InvalidCanvasError } from './services/canvas.js';
export { InvalidAgentRunError } from './services/agent-runs.js';
export { InvalidScaffoldError } from './services/projects.js';
export { InvalidShareError, type ShareService } from './services/share.js';
export {
  InvalidRevisionQueryError,
  type RevisionService,
} from './services/revisions.js';
export {
  InvalidTriageError,
  InvalidTriageInputError,
  SubmissionRetriageMismatchError,
  SyncUnavailableError,
  SyncUnauthorizedError,
  type SyncRemote,
  type SyncService,
} from './services/sync.js';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const version = (): string => {
  // Lazy: module-level fileURLToPath(import.meta.url) breaks the Cloudflare
  // Workers bundle. Resolve only when version() is actually called.
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};
