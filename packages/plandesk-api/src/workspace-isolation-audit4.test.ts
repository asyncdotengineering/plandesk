import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createArtifact,
  createComment,
  createDb,
  createDocument,
  createFolder,
  createGoal,
  createGuestSubmission,
  createNote,
  createShare,
  createTag,
  createTaskWithDefaultGoal as createTask,
  getAgentRun,
  getArtifact,
  getComment,
  getDocument,
  getFolder,
  getGoal,
  getNote,
  getProject,
  getSubmission,
  getTask,
  listAgentRuns,
  listArtifactsByProject,
  listCommentsByProject,
  listDocuments,
  listEdges,
  listFolders,
  listGoals,
  listNotes,
  listShares,
  listSubmissions,
  listTasks,
  migrate,
  type Db,
  type Project,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import {
  createOrgOwnerKey,
  createWorkspaceScopedAgentKey,
  DEFAULT_AGENT_KEY_PERMISSIONS,
  DEFAULT_OWNER_KEY_PERMISSIONS,
} from './agent-keys.js';
import { runWithAuthContext, type AuthContext } from './auth-context.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { createTeamForOrg } from './identity.js';
import { createApp } from './server.js';
import { createServices, type Services } from './services/index.js';
import { parseJson } from './test-helpers.js';
import { createAddArtifactCommentHandler } from '../../plandesk-mcp/src/tools/add-artifact-comment.js';
import { createAddCommentHandler } from '../../plandesk-mcp/src/tools/add-comment.js';
import { createAttachFileHandler } from '../../plandesk-mcp/src/tools/attach-file.js';
import { createClaimTaskHandler } from '../../plandesk-mcp/src/tools/claim-task.js';
import { createCompleteAgentRunHandler } from '../../plandesk-mcp/src/tools/complete-agent-run.js';
import { createCreateArtifactHandler } from '../../plandesk-mcp/src/tools/create-artifact.js';
import { createCreateDocumentHandler } from '../../plandesk-mcp/src/tools/create-document.js';
import { createCreateEdgeHandler } from '../../plandesk-mcp/src/tools/create-edge.js';
import { createCreateFolderHandler } from '../../plandesk-mcp/src/tools/create-folder.js';
import { createCreateGoalHandler } from '../../plandesk-mcp/src/tools/create-goal.js';
import { createCreateNoteHandler } from '../../plandesk-mcp/src/tools/create-note.js';
import { createCreateProjectHandler } from '../../plandesk-mcp/src/tools/create-project.js';
import { createCreateShareLinkHandler } from '../../plandesk-mcp/src/tools/create-share-link.js';
import { createCreateTaskHandler } from '../../plandesk-mcp/src/tools/create-task.js';
import { createGetArtifactHandler } from '../../plandesk-mcp/src/tools/get-artifact.js';
import { createGetDocumentHandler } from '../../plandesk-mcp/src/tools/get-document.js';
import { createGetGoalHandler } from '../../plandesk-mcp/src/tools/get-goal.js';
import { createGetNextTaskHandler } from '../../plandesk-mcp/src/tools/get-next-task.js';
import { createGetNoteHandler } from '../../plandesk-mcp/src/tools/get-note.js';
import { createGetProjectHandler } from '../../plandesk-mcp/src/tools/get-project.js';
import { createGetTaskHandler } from '../../plandesk-mcp/src/tools/get-task.js';
import { createListArtifactCommentsHandler } from '../../plandesk-mcp/src/tools/list-artifact-comments.js';
import { createListArtifactsHandler } from '../../plandesk-mcp/src/tools/list-artifacts.js';
import { createListCommentsHandler } from '../../plandesk-mcp/src/tools/list-comments.js';
import { createListDocumentsHandler } from '../../plandesk-mcp/src/tools/list-documents.js';
import { createListGoalsHandler } from '../../plandesk-mcp/src/tools/list-goals.js';
import { createListNotesHandler } from '../../plandesk-mcp/src/tools/list-notes.js';
import { createListProjectsHandler } from '../../plandesk-mcp/src/tools/list-projects.js';
import { createListSubmissionsHandler } from '../../plandesk-mcp/src/tools/list-submissions.js';
import { createListTagsHandler } from '../../plandesk-mcp/src/tools/list-tags.js';
import { createListTasksHandler } from '../../plandesk-mcp/src/tools/list-tasks.js';
import {
  createCompleteGoalHandler,
  createPauseGoalHandler,
  createResumeGoalHandler,
} from '../../plandesk-mcp/src/tools/goal-lifecycle.js';
import { createRecordAgentProgressHandler } from '../../plandesk-mcp/src/tools/record-agent-progress.js';
import { createResolveCommentHandler } from '../../plandesk-mcp/src/tools/resolve-comment.js';
import { createScaffoldProjectFromPlanHandler } from '../../plandesk-mcp/src/tools/scaffold-project-from-plan.js';
import { createStartAgentRunHandler } from '../../plandesk-mcp/src/tools/start-agent-run.js';
import { createSyncPullHandler } from '../../plandesk-mcp/src/tools/sync-pull.js';
import { createTriageSubmissionHandler } from '../../plandesk-mcp/src/tools/triage-submission.js';
import { createUpdateArtifactHandler } from '../../plandesk-mcp/src/tools/update-artifact.js';
import { createUpdateDocumentHandler } from '../../plandesk-mcp/src/tools/update-document.js';
import { createUpdateFolderHandler } from '../../plandesk-mcp/src/tools/update-folder.js';
import { createUpdateGoalHandler } from '../../plandesk-mcp/src/tools/update-goal.js';
import { createUpdateNoteHandler } from '../../plandesk-mcp/src/tools/update-note.js';
import { createUpdateTaskHandler } from '../../plandesk-mcp/src/tools/update-task.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

const MCP_TOOLS = [
  'list_projects',
  'get_project',
  'create_project',
  'create_task',
  'update_task',
  'create_document',
  'update_document',
  'get_document',
  'list_documents',
  'create_folder',
  'update_folder',
  'create_note',
  'update_note',
  'get_note',
  'list_notes',
  'create_artifact',
  'get_artifact',
  'update_artifact',
  'list_artifacts',
  'create_edge',
  'attach_file',
  'create_share_link',
  'start_agent_run',
  'record_agent_progress',
  'complete_agent_run',
  'scaffold_project_from_plan',
  'create_goal',
  'get_goal',
  'list_goals',
  'update_goal',
  'pause_goal',
  'resume_goal',
  'complete_goal',
  'get_next_task',
  'claim_task',
  'get_task',
  'list_tasks',
  'list_tags',
  'list_comments',
  'add_comment',
  'list_artifact_comments',
  'add_artifact_comment',
  'resolve_comment',
  'sync_pull',
  'list_submissions',
  'triage_submission',
] as const;

type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ForeignResources = {
  project: Project;
  task: Awaited<ReturnType<typeof createTask>>;
  task2: Awaited<ReturnType<typeof createTask>>;
  document: Awaited<ReturnType<typeof createDocument>>;
  folder: Awaited<ReturnType<typeof createFolder>>;
  note: Awaited<ReturnType<typeof createNote>>;
  artifact: Awaited<ReturnType<typeof createArtifact>>;
  activeGoal: Awaited<ReturnType<typeof createGoal>>;
  pausedGoal: Awaited<ReturnType<typeof createGoal>>;
  completableGoal: Awaited<ReturnType<typeof createGoal>>;
  progressRun: Awaited<ReturnType<typeof createAgentRun>>;
  completeRun: Awaited<ReturnType<typeof createAgentRun>>;
  comment: Awaited<ReturnType<typeof createComment>>;
  submission: Awaited<ReturnType<typeof createGuestSubmission>>;
};

type Fixture = {
  app: Hono;
  auth: BetterAuthInstance;
  db: Db;
  services: Services;
  orgId: string;
  otherOrgId: string;
  ownerUserId: string;
  workspaceA: string;
  workspaceB: string;
  otherWorkspace: string;
  projectA: Project;
  projectB: Project;
  otherProject: Project;
  workspaceAKey: string;
  ownerKey: string;
  foreignB: ForeignResources;
  foreignOtherOrg: ForeignResources;
};

type McpResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function seedOwner(
  auth: BetterAuthInstance,
  orgId: string,
  label: string,
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  await adapter.create({
    model: 'organization',
    data: { id: orgId, name: `${label} Org`, slug: `${label}-${orgId}`, createdAt: now },
    forceAllowId: true,
  });
  const user = await adapter.create<UserRow>({
    model: 'user',
    data: {
      name: `${label} Owner`,
      email: `${label}-${orgId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create({
    model: 'member',
    data: { organizationId: orgId, userId: user.id, role: 'owner', createdAt: now },
  });
  return user.id;
}

async function seedForeignResources(db: Db, project: Project, label: string): Promise<ForeignResources> {
  const task = await createTask(db, { projectId: project.id, label: `${label} task secret` });
  const task2 = await createTask(db, { projectId: project.id, label: `${label} task two secret` });
  const document = await createDocument(db, {
    projectId: project.id,
    title: `${label} document secret`,
    body: `<p>${label} document body secret</p>`,
  });
  const folder = await createFolder(db, { projectId: project.id, name: `${label} folder secret` });
  const note = await createNote(db, {
    projectId: project.id,
    title: `${label} note secret`,
    body: `${label} note body secret`,
  });
  const artifact = await createArtifact(db, {
    projectId: project.id,
    title: `${label} artifact secret`,
    content: `${label} artifact body secret`,
  });
  await createTag(db, { projectId: project.id, name: `${label}-secret-tag` });
  const activeGoal = await createGoal(db, {
    projectId: project.id,
    objective: `${label} active goal secret`,
    status: 'active',
  });
  const pausedGoal = await createGoal(db, {
    projectId: project.id,
    objective: `${label} paused goal secret`,
    status: 'paused',
  });
  const completableGoal = await createGoal(db, {
    projectId: project.id,
    objective: `${label} completable goal secret`,
    status: 'active',
  });
  const progressRun = await createAgentRun(db, { projectId: project.id, label: `${label} progress run` });
  const completeRun = await createAgentRun(db, { projectId: project.id, label: `${label} complete run` });
  const comment = await createComment(db, {
    projectId: project.id,
    targetType: 'task',
    targetId: task.id,
    body: `${label} comment secret`,
  });
  const hosted = await createShare(db, {
    projectId: project.id,
    audienceName: `${label} submission portal`,
    mode: 'public',
    permissions: { read: true, submit: true },
    policy: { tasks: 'all', documentIds: [], fields: {} },
  });
  const submission = await createGuestSubmission(db, {
    projectId: project.id,
    hostedShareId: hosted.share.id,
    participantName: `${label} participant`,
    title: `${label} submission secret`,
  });
  return {
    project,
    task,
    task2,
    document,
    folder,
    note,
    artifact,
    activeGoal,
    pausedGoal,
    completableGoal,
    progressRun,
    completeRun,
    comment,
    submission,
  };
}

async function fixture(): Promise<Fixture> {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    github: { clientId: 'test-client', clientSecret: 'test-secret' },
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const ownerUserId = await seedOwner(auth, orgId, 'audit-4-a');
  const otherOwnerUserId = await seedOwner(auth, otherOrgId, 'audit-4-b');
  const workspaceA = (await createTeamForOrg(auth, orgId, 'Workspace A')).id;
  const workspaceB = (await createTeamForOrg(auth, orgId, 'Workspace B')).id;
  const otherWorkspace = (await createTeamForOrg(auth, otherOrgId, 'Other org workspace')).id;
  const projectA = await createProject(db, { name: 'Project A', orgId, workspaceId: workspaceA });
  const projectB = await createProject(db, {
    name: 'Project B secret',
    description: 'workspace B confidential metadata',
    orgId,
    workspaceId: workspaceB,
  });
  const otherProject = await createProject(db, {
    name: 'Other org project secret',
    description: 'cross-org confidential metadata',
    orgId: otherOrgId,
    workspaceId: otherWorkspace,
  });
  const workspaceKey = await createWorkspaceScopedAgentKey({
    auth,
    userId: ownerUserId,
    orgId,
    teamId: workspaceA,
    permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
    name: 'workspace-a-agent',
  });
  const owner = await createOrgOwnerKey({
    auth,
    userId: ownerUserId,
    orgId,
    permissions: DEFAULT_OWNER_KEY_PERMISSIONS,
    name: 'org-a-owner',
  });
  // Keep the other owner live so the second org is a realistic tenant, not an
  // orphaned set of rows that only happens to carry another org_id.
  await createOrgOwnerKey({
    auth,
    userId: otherOwnerUserId,
    orgId: otherOrgId,
    permissions: DEFAULT_OWNER_KEY_PERMISSIONS,
    name: 'org-b-owner',
  });

  const services = createServices({ db, auth });
  const app = createApp({
    db,
    services,
    betterAuthInstance: auth,
    bindHost: '0.0.0.0',
  });
  return {
    app,
    auth,
    db,
    services,
    orgId,
    otherOrgId,
    ownerUserId,
    workspaceA,
    workspaceB,
    otherWorkspace,
    projectA,
    projectB,
    otherProject,
    workspaceAKey: workspaceKey.key,
    ownerKey: owner.key,
    foreignB: await seedForeignResources(db, projectB, 'workspace-b'),
    foreignOtherOrg: await seedForeignResources(db, otherProject, 'other-org'),
  };
}

function workspaceContext(f: Fixture): AuthContext {
  return {
    kind: 'apikey',
    orgId: f.orgId,
    userId: f.ownerUserId,
    profile: 'agent',
    role: 'owner',
    workspaceId: f.workspaceA,
    permission: DEFAULT_AGENT_KEY_PERMISSIONS,
  };
}

function ownerContext(f: Fixture): AuthContext {
  return {
    kind: 'apikey',
    orgId: f.orgId,
    userId: f.ownerUserId,
    profile: 'owner',
    role: 'owner',
    permission: DEFAULT_OWNER_KEY_PERMISSIONS,
  };
}

function sessionOwnerContext(f: Fixture): AuthContext {
  return {
    kind: 'session',
    orgId: f.orgId,
    userRef: `user:${f.ownerUserId}`,
    userId: f.ownerUserId,
    role: 'owner',
    permission: DEFAULT_OWNER_KEY_PERMISSIONS,
    memberWorkspaceIds: [],
  };
}

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

function jsonHeaders(key: string): Record<string, string> {
  return { ...bearer(key), 'Content-Type': 'application/json' };
}

function toolPayload(result: McpResult): unknown {
  return JSON.parse(result.content[0]?.text ?? '{}') as unknown;
}

async function join(app: Hono, token: string, name: string, email?: string): Promise<string> {
  const response = await app.request(`/api/v1/share/${token}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
  expect(response.status).toBe(200);
  return (await parseJson<{ session_token: string }>(response)).session_token;
}

async function mutationSnapshot(db: Db, target: ForeignResources) {
  return {
    task: await getTask(db, target.task.id),
    document: await getDocument(db, target.document.id),
    folder: await getFolder(db, target.folder.id),
    note: await getNote(db, target.note.id),
    artifact: await getArtifact(db, target.artifact.id),
    activeGoal: await getGoal(db, target.activeGoal.id),
    pausedGoal: await getGoal(db, target.pausedGoal.id),
    completableGoal: await getGoal(db, target.completableGoal.id),
    progressRun: await getAgentRun(db, target.progressRun.id),
    completeRun: await getAgentRun(db, target.completeRun.id),
    comment: await getComment(db, target.comment.id),
    submission: await getSubmission(db, target.submission.id),
    counts: {
      tasks: (await listTasks(db, target.project.id)).length,
      documents: (await listDocuments(db, target.project.id)).length,
      folders: (await listFolders(db, target.project.id)).length,
      notes: (await listNotes(db, target.project.id)).length,
      artifacts: (await listArtifactsByProject(db, target.project.id)).length,
      goals: (await listGoals(db, target.project.id)).length,
      runs: (await listAgentRuns(db, target.project.id)).length,
      comments: (await listCommentsByProject(db, target.project.id)).length,
      edges: (await listEdges(db, target.project.id)).length,
      shares: (await listShares(db, target.project.id)).length,
      submissions: (await listSubmissions(db, target.project.id)).length,
    },
  };
}

async function runMcpForeignSweep(
  f: Fixture,
  context: AuthContext,
  target: ForeignResources,
  expectedVisibleProjectIds: string[],
) {
  const s = f.services;
  const before = await mutationSnapshot(f.db, target);

  const listProjects = await runWithAuthContext(context, () =>
    createListProjectsHandler(s.projectService)(),
  );
  const listed = (toolPayload(listProjects) as { projects: Array<{ id: string }> }).projects;
  expect(listed.map((project) => project.id).sort()).toEqual(expectedVisibleProjectIds.sort());
  expect(JSON.stringify(listProjects)).not.toContain(target.project.description ?? 'foreign secret');

  const createProjectResult = await runWithAuthContext(context, () =>
    createCreateProjectHandler(s.projectService)({ name: 'MCP safely scoped project' }),
  );
  expect(createProjectResult.isError).not.toBe(true);
  const createdProject = (toolPayload(createProjectResult) as { project: { id: string } }).project;
  const createdProjectRow = await getProject(f.db, createdProject.id);
  expect(createdProjectRow?.orgId).toBe(f.orgId);
  if (context.kind === 'apikey' && context.workspaceId !== undefined) {
    expect(createdProjectRow?.workspaceId).toBe(context.workspaceId);
  }

  const scaffoldNewResult = await runWithAuthContext(context, () =>
    createScaffoldProjectFromPlanHandler(s.projectService)({
      name: 'MCP safely scoped scaffold',
      tasks: [{ key: 'safe', label: 'Safe task' }],
    }),
  );
  expect(scaffoldNewResult.isError).not.toBe(true);
  const scaffold = (
    toolPayload(scaffoldNewResult) as { scaffold: { project: { id: string } } }
  ).scaffold;
  const scaffoldProject = await getProject(f.db, scaffold.project.id);
  expect(scaffoldProject?.orgId).toBe(f.orgId);
  if (context.kind === 'apikey' && context.workspaceId !== undefined) {
    expect(scaffoldProject?.workspaceId).toBe(context.workspaceId);
  }

  const deniedCalls: Array<[string, () => Promise<McpResult>]> = [
    ['get_project', () => createGetProjectHandler(s.projectService)({ project_id: target.project.id })],
    [
      'create_task',
      () =>
        createCreateTaskHandler(s.taskService)({
          project_id: target.project.id,
          label: 'escaped task',
        }),
    ],
    [
      'update_task',
      () => createUpdateTaskHandler(s.taskService)({ task_id: target.task.id, label: 'escaped' }),
    ],
    [
      'create_document',
      () =>
        createCreateDocumentHandler(s.documentService)({
          project_id: target.project.id,
          title: 'escaped document',
        }),
    ],
    [
      'update_document',
      () =>
        createUpdateDocumentHandler(s.documentService)({
          document_id: target.document.id,
          title: 'escaped',
        }),
    ],
    [
      'get_document',
      () => createGetDocumentHandler(s.documentService)({ document_id: target.document.id }),
    ],
    [
      'list_documents',
      () => createListDocumentsHandler(s.documentService)({ project_id: target.project.id }),
    ],
    [
      'create_folder',
      () =>
        createCreateFolderHandler(s.folderService)({
          project_id: target.project.id,
          name: 'escaped folder',
        }),
    ],
    [
      'update_folder',
      () => createUpdateFolderHandler(s.folderService)({ folder_id: target.folder.id, name: 'escaped' }),
    ],
    [
      'create_note',
      () =>
        createCreateNoteHandler(s.noteService)({ project_id: target.project.id, title: 'escaped note' }),
    ],
    [
      'update_note',
      () => createUpdateNoteHandler(s.noteService)({ note_id: target.note.id, title: 'escaped' }),
    ],
    ['get_note', () => createGetNoteHandler(s.noteService)({ note_id: target.note.id })],
    ['list_notes', () => createListNotesHandler(s.noteService)({ project_id: target.project.id })],
    [
      'create_artifact',
      () =>
        createCreateArtifactHandler(s.artifactService)({
          project_id: target.project.id,
          title: 'escaped artifact',
          content: 'escaped',
        }),
    ],
    [
      'get_artifact',
      () => createGetArtifactHandler(s.artifactService)({ artifact_id: target.artifact.id }),
    ],
    [
      'update_artifact',
      () =>
        createUpdateArtifactHandler(s.artifactService)({
          artifact_id: target.artifact.id,
          title: 'escaped',
        }),
    ],
    [
      'list_artifacts',
      () => createListArtifactsHandler(s.artifactService)({ project_id: target.project.id }),
    ],
    [
      'create_edge',
      () =>
        createCreateEdgeHandler(s.canvasService)({
          project_id: target.project.id,
          from_task_id: target.task.id,
          to_task_id: target.task2.id,
        }),
    ],
    [
      'attach_file',
      () =>
        createAttachFileHandler(s.fileService)({
          project_id: target.project.id,
          filename: 'escaped.txt',
          content_base64: Buffer.from('escaped').toString('base64'),
          mime: 'text/plain',
        }),
    ],
    [
      'create_share_link',
      () =>
        createCreateShareLinkHandler(s.shareService, () => TEST_BASE_URL)({
          task_id: target.task.id,
        }),
    ],
    [
      'start_agent_run',
      () =>
        createStartAgentRunHandler(s.agentRunService)({
          project_id: target.project.id,
          label: 'escaped run',
        }),
    ],
    [
      'record_agent_progress',
      () =>
        createRecordAgentProgressHandler(s.agentRunService)({
          run_id: target.progressRun.id,
          message: 'escaped progress',
        }),
    ],
    [
      'complete_agent_run',
      () =>
        createCompleteAgentRunHandler(s.agentRunService)({
          run_id: target.completeRun.id,
          status: 'completed',
        }),
    ],
    [
      'scaffold_project_from_plan',
      () =>
        createScaffoldProjectFromPlanHandler(s.projectService)({
          project_id: target.project.id,
          tasks: [{ key: 'escaped', label: 'escaped scaffold task' }],
        }),
    ],
    [
      'create_goal',
      () =>
        createCreateGoalHandler(s.goalService)({
          project_id: target.project.id,
          objective: 'escaped goal',
        }),
    ],
    ['get_goal', () => createGetGoalHandler(s.goalService)({ goal_id: target.activeGoal.id })],
    ['list_goals', () => createListGoalsHandler(s.goalService)({ project_id: target.project.id })],
    [
      'update_goal',
      () => createUpdateGoalHandler(s.goalService)({ goal_id: target.activeGoal.id, objective: 'escaped' }),
    ],
    ['pause_goal', () => createPauseGoalHandler(s.goalService)({ goal_id: target.activeGoal.id })],
    ['resume_goal', () => createResumeGoalHandler(s.goalService)({ goal_id: target.pausedGoal.id })],
    [
      'complete_goal',
      () => createCompleteGoalHandler(s.goalService)({ goal_id: target.completableGoal.id }),
    ],
    [
      'get_next_task',
      () =>
        createGetNextTaskHandler(s.taskService)({
          project_id: target.project.id,
          goal_id: target.activeGoal.id,
        }),
    ],
    [
      'claim_task',
      () => createClaimTaskHandler(s.taskService)({ task_id: target.task.id, agent_ref: 'attacker' }),
    ],
    ['get_task', () => createGetTaskHandler(s.taskService)({ task_id: target.task.id })],
    ['list_tasks', () => createListTasksHandler(s.taskService)({ project_id: target.project.id })],
    ['list_tags', () => createListTagsHandler(s.tagService)({ project_id: target.project.id })],
    [
      'list_comments',
      () => createListCommentsHandler(s.commentService)({ project_id: target.project.id }),
    ],
    [
      'add_comment',
      () =>
        createAddCommentHandler(s.commentService)({
          target_type: 'task',
          target_id: target.task.id,
          body: 'escaped comment',
        }),
    ],
    [
      'list_artifact_comments',
      () =>
        createListArtifactCommentsHandler(s.commentService)({
          project_id: target.project.id,
          artifact_id: target.artifact.id,
        }),
    ],
    [
      'add_artifact_comment',
      () =>
        createAddArtifactCommentHandler(s.commentService)({
          project_id: target.project.id,
          artifact_id: target.artifact.id,
          body: 'escaped artifact comment',
        }),
    ],
    [
      'resolve_comment',
      () => createResolveCommentHandler(s.commentService)({ comment_id: target.comment.id }),
    ],
    ['sync_pull', () => createSyncPullHandler(s.syncService)({ project_id: target.project.id })],
    [
      'list_submissions',
      () =>
        createListSubmissionsHandler(
          s.syncService,
          async (projectId) => (await s.projectService.get(projectId)) !== undefined,
        )({ project_id: target.project.id }),
    ],
    [
      'triage_submission',
      () =>
        createTriageSubmissionHandler(s.syncService)({
          submission_id: target.submission.id,
          action: 'accept',
          as_task: { label: 'escaped triage task' },
        }),
    ],
  ];

  const denied = await runWithAuthContext(context, () =>
    Promise.all(
      deniedCalls.map(async ([name, call]) => {
        try {
          return [name, await call()] as const;
        } catch (error) {
          // Cross-package source tests can load the service error class and the
          // handler's @plandesk/api error class as distinct module instances,
          // making an otherwise-caught instanceof escape. A throw is still a
          // denied call; the snapshot below proves it did not mutate foreign data.
          return [
            name,
            {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'thrown',
                    name: error instanceof Error ? error.name : 'unknown',
                  }),
                },
              ],
              isError: true,
            },
          ] as const;
        }
      }),
    ),
  );
  const failures = denied
    .filter(([, result]) => result.isError !== true)
    .map(([name, result]) => ({ name, payload: toolPayload(result) }));
  expect(failures).toEqual([]);
  expect(JSON.stringify(denied)).not.toContain(target.project.description ?? 'foreign secret');
  expect(await mutationSnapshot(f.db, target)).toEqual(before);

  const covered = new Set(['list_projects', 'create_project', ...denied.map(([name]) => name)]);
  // The existing-project and new-project branches of scaffold are both called;
  // the registration name appears once in the inventory.
  expect([...MCP_TOOLS].filter((name) => !covered.has(name))).toEqual([]);
}

describe('workspace-tier adversarial audit round 4', () => {
  it('locks the sweep inventory to every tool registered in server.ts', () => {
    const serverSource = readFileSync(
      new URL('../../plandesk-mcp/src/server.ts', import.meta.url),
      'utf8',
    );
    const registered = [...serverSource.matchAll(/registerTool\(\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(registered).toEqual([...MCP_TOOLS]);
  });

  it('full MCP sweep: a workspace-A key gets errors and causes no mutation in workspace B', async () => {
    const f = await fixture();
    await runMcpForeignSweep(f, workspaceContext(f), f.foreignB, [f.projectA.id]);
  });

  it('full MCP sweep: an org-A owner key gets errors and causes no mutation in org B', async () => {
    const f = await fixture();
    await runMcpForeignSweep(
      f,
      ownerContext(f),
      f.foreignOtherOrg,
      [f.projectA.id, f.projectB.id],
    );
  });

  it('foreign-id write references are rejected while the local parent remains unchanged', async () => {
    const f = await fixture();
    const taskA = await createTask(f.db, { projectId: f.projectA.id, label: 'local task' });
    const documentA = await createDocument(f.db, {
      projectId: f.projectA.id,
      title: 'local document',
    });
    const folderA = await createFolder(f.db, { projectId: f.projectA.id, name: 'local folder' });
    const shareA = await createShare(f.db, {
      projectId: f.projectA.id,
      audienceName: 'Local triage',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const submissionA = await createGuestSubmission(f.db, {
      projectId: f.projectA.id,
      hostedShareId: shareA.share.id,
      participantName: 'Local client',
      title: 'Local issue',
    });
    const before = {
      taskCount: (await listTasks(f.db, f.projectA.id)).length,
      document: await getDocument(f.db, documentA.id),
      documentCount: (await listDocuments(f.db, f.projectA.id)).length,
      folder: await getFolder(f.db, folderA.id),
      folderCount: (await listFolders(f.db, f.projectA.id)).length,
      edgeCount: (await listEdges(f.db, f.projectA.id)).length,
      submission: await getSubmission(f.db, submissionA.id),
    };

    const results = await runWithAuthContext(workspaceContext(f), () =>
      Promise.allSettled([
        createCreateTaskHandler(f.services.taskService)({
          project_id: f.projectA.id,
          label: 'foreign goal ref',
          goal_id: f.foreignB.activeGoal.id,
        }),
        createCreateDocumentHandler(f.services.documentService)({
          project_id: f.projectA.id,
          title: 'foreign task ref',
          linked_task_id: f.foreignB.task.id,
        }),
        createCreateDocumentHandler(f.services.documentService)({
          project_id: f.projectA.id,
          title: 'foreign document parent ref',
          parent_id: f.foreignB.document.id,
        }),
        createCreateDocumentHandler(f.services.documentService)({
          project_id: f.projectA.id,
          title: 'foreign folder ref',
          folder_id: f.foreignB.folder.id,
        }),
        createUpdateDocumentHandler(f.services.documentService)({
          document_id: documentA.id,
          linked_task_id: f.foreignB.task.id,
        }),
        createUpdateDocumentHandler(f.services.documentService)({
          document_id: documentA.id,
          folder_id: f.foreignB.folder.id,
        }),
        createCreateFolderHandler(f.services.folderService)({
          project_id: f.projectA.id,
          name: 'foreign parent folder ref',
          parent_folder_id: f.foreignB.folder.id,
        }),
        createUpdateFolderHandler(f.services.folderService)({
          folder_id: folderA.id,
          parent_folder_id: f.foreignB.folder.id,
        }),
        createCreateEdgeHandler(f.services.canvasService)({
          project_id: f.projectA.id,
          from_task_id: taskA.id,
          to_task_id: f.foreignB.task.id,
        }),
        createTriageSubmissionHandler(f.services.syncService)({
          submission_id: submissionA.id,
          action: 'accept',
          link_task_id: f.foreignB.task.id,
        }),
      ]),
    );

    expect(
      results.every((result) => result.status === 'rejected' || result.value.isError === true),
    ).toBe(true);
    expect({
      taskCount: (await listTasks(f.db, f.projectA.id)).length,
      document: await getDocument(f.db, documentA.id),
      documentCount: (await listDocuments(f.db, f.projectA.id)).length,
      folder: await getFolder(f.db, folderA.id),
      folderCount: (await listFolders(f.db, f.projectA.id)).length,
      edgeCount: (await listEdges(f.db, f.projectA.id)).length,
      submission: await getSubmission(f.db, submissionA.id),
    }).toEqual(before);

    const parentPatch = await f.app.request(`/api/v1/documents/${documentA.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(f.workspaceAKey),
      body: JSON.stringify({ parent_id: f.foreignB.document.id }),
    });
    expect(parentPatch.status).toBe(400);
    expect(await getDocument(f.db, documentA.id)).toEqual(before.document);
  });

  it('guest session endpoints deny project-share/workspace-share token swaps and foreign project targets', async () => {
    const f = await fixture();
    const projectDocument = await createDocument(f.db, {
      projectId: f.projectA.id,
      title: 'Project A portal document',
      body: '<p>project A portal-only body</p>',
    });
    const projectShare = await createShare(f.db, {
      projectId: f.projectA.id,
      audienceName: 'Project A portal',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [projectDocument.id], fields: {} },
    });
    const workspaceShare = await createShare(f.db, {
      workspaceId: f.workspaceB,
      audienceName: 'Workspace B portal',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const inviteOnlyOther = await createShare(f.db, {
      projectId: f.otherProject.id,
      audienceName: 'Other org invited portal',
      mode: 'invite',
      invitedEmails: ['allowed@other.example'],
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [f.foreignOtherOrg.document.id], fields: {} },
    });
    const projectGuest = await join(f.app, projectShare.token, 'Project guest');
    const workspaceGuest = await join(f.app, workspaceShare.token, 'Workspace guest');

    const swapped = await Promise.all([
      f.app.request(`/api/v1/share/${workspaceShare.token}/view`, { headers: bearer(projectGuest) }),
      f.app.request(`/api/v1/share/${projectShare.token}/view`, { headers: bearer(workspaceGuest) }),
      f.app.request(`/api/v1/share/${workspaceShare.token}/submissions`, {
        method: 'POST',
        headers: jsonHeaders(projectGuest),
        body: JSON.stringify({ title: 'escaped', project_id: f.projectB.id }),
      }),
      f.app.request(`/api/v1/share/${projectShare.token}/submissions`, {
        method: 'POST',
        headers: jsonHeaders(workspaceGuest),
        body: JSON.stringify({ title: 'escaped' }),
      }),
      f.app.request(`/api/v1/share/${workspaceShare.token}/submissions`, {
        headers: bearer(projectGuest),
      }),
      f.app.request(`/api/v1/share/${projectShare.token}/submissions`, {
        headers: bearer(workspaceGuest),
      }),
    ]);
    expect(swapped.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);

    const foreignWorkspaceTargets = await Promise.all([
      f.app.request(`/api/v1/share/${workspaceShare.token}/submissions`, {
        method: 'POST',
        headers: jsonHeaders(workspaceGuest),
        body: JSON.stringify({ title: 'same-org escape', project_id: f.projectA.id }),
      }),
      f.app.request(`/api/v1/share/${workspaceShare.token}/submissions`, {
        method: 'POST',
        headers: jsonHeaders(workspaceGuest),
        body: JSON.stringify({ title: 'cross-org escape', project_id: f.otherProject.id }),
      }),
    ]);
    expect(foreignWorkspaceTargets.map((response) => response.status)).toEqual([401, 401]);

    // A project share ignores a caller-supplied project_id and always lands in
    // its own bound project; this verifies the field cannot retarget the write.
    const projectSubmit = await f.app.request(`/api/v1/share/${projectShare.token}/submissions`, {
      method: 'POST',
      headers: jsonHeaders(projectGuest),
      body: JSON.stringify({ title: 'bound issue', project_id: f.projectB.id }),
    });
    expect(projectSubmit.status).toBe(201);
    const submitted = await parseJson<{ submission: { id: string } }>(projectSubmit);
    expect((await getSubmission(f.db, submitted.submission.id))?.projectId).toBe(f.projectA.id);

    // Markdown is a pre-join capability endpoint. Invite-only shares remain
    // closed even when a valid guest bearer for some other share is attached.
    const inviteMarkdown = await f.app.request(`/api/v1/share/${inviteOnlyOther.token}.md`, {
      headers: bearer(projectGuest),
    });
    const workspaceMarkdown = await f.app.request(`/api/v1/share/${workspaceShare.token}.md`, {
      headers: bearer(projectGuest),
    });
    const projectMarkdown = await f.app.request(`/api/v1/share/${projectShare.token}.md`, {
      headers: bearer(workspaceGuest),
    });
    const projectMarkdownBody = await projectMarkdown.text();
    expect([inviteMarkdown.status, workspaceMarkdown.status, projectMarkdown.status]).toEqual([
      404, 404, 200,
    ]);
    expect(projectMarkdownBody).toContain('Project A portal document');
    expect(projectMarkdownBody).not.toContain('workspace-b');
    expect(projectMarkdownBody).not.toContain('other-org');

    // Meta/join intentionally authorize by the exact URL token, not by an
    // existing guest session. That token reveals only join metadata, and the
    // foreign invite allow-list still applies.
    const [projectToWorkspaceMeta, workspaceToProjectMeta, foreignMeta] = await Promise.all([
      f.app.request(`/api/v1/share/${workspaceShare.token}/meta`, {
        headers: bearer(projectGuest),
      }),
      f.app.request(`/api/v1/share/${projectShare.token}/meta`, {
        headers: bearer(workspaceGuest),
      }),
      f.app.request(`/api/v1/share/${inviteOnlyOther.token}/meta`, {
        headers: bearer(projectGuest),
      }),
    ]);
    const metaBodies = await Promise.all([
      projectToWorkspaceMeta.text(),
      workspaceToProjectMeta.text(),
      foreignMeta.text(),
    ]);
    expect([projectToWorkspaceMeta.status, workspaceToProjectMeta.status, foreignMeta.status]).toEqual([
      200, 200, 200,
    ]);
    expect(metaBodies.every((body) => !body.includes('confidential metadata'))).toBe(true);

    const foreignJoin = await f.app.request(`/api/v1/share/${inviteOnlyOther.token}/join`, {
      method: 'POST',
      headers: jsonHeaders(projectGuest),
      body: JSON.stringify({ name: 'Project guest', email: 'wrong@example.com' }),
    });
    const projectToWorkspaceJoin = await f.app.request(`/api/v1/share/${workspaceShare.token}/join`, {
      method: 'POST',
      headers: jsonHeaders(projectGuest),
      body: JSON.stringify({ name: 'New workspace guest' }),
    });
    const workspaceToProjectJoin = await f.app.request(`/api/v1/share/${projectShare.token}/join`, {
      method: 'POST',
      headers: jsonHeaders(workspaceGuest),
      body: JSON.stringify({ name: 'New project guest' }),
    });
    expect([foreignJoin.status, projectToWorkspaceJoin.status, workspaceToProjectJoin.status]).toEqual([
      403, 200, 200,
    ]);
    const newWorkspaceGuest = (
      await parseJson<{ session_token: string }>(projectToWorkspaceJoin)
    ).session_token;
    const newProjectGuest = (
      await parseJson<{ session_token: string }>(workspaceToProjectJoin)
    ).session_token;
    const remintedCrossChecks = await Promise.all([
      f.app.request(`/api/v1/share/${projectShare.token}/view`, {
        headers: bearer(newWorkspaceGuest),
      }),
      f.app.request(`/api/v1/share/${workspaceShare.token}/view`, {
        headers: bearer(newProjectGuest),
      }),
    ]);
    expect(remintedCrossChecks.map((response) => response.status)).toEqual([404, 404]);
  });

  it('org-A owner key is org-wide inside A but every sampled cross-org HTTP path is closed', async () => {
    const f = await fixture();
    const crossOrgReads = await Promise.all([
      f.app.request(`/api/v1/projects/${f.otherProject.id}`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/tasks`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/documents`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/notes`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/goals`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/folders`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/tags`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/artifacts`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/agent-runs`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/submissions`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/projects/${f.otherProject.id}/canvas`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/tasks/${f.foreignOtherOrg.task.id}`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/documents/${f.foreignOtherOrg.document.id}`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/notes/${f.foreignOtherOrg.note.id}`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/folders/${f.foreignOtherOrg.folder.id}`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/artifacts/${f.foreignOtherOrg.artifact.id}`, { headers: bearer(f.ownerKey) }),
      f.app.request(`/api/v1/goals/${f.foreignOtherOrg.activeGoal.id}`, { headers: bearer(f.ownerKey) }),
    ]);
    expect(crossOrgReads.every((response) => response.status === 404)).toBe(true);

    const before = await mutationSnapshot(f.db, f.foreignOtherOrg);
    const crossOrgWrites = await Promise.all([
      f.app.request(`/api/v1/projects/${f.otherProject.id}/tasks`, {
        method: 'POST',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({ label: 'escaped' }),
      }),
      f.app.request(`/api/v1/tasks/${f.foreignOtherOrg.task.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({ label: 'escaped' }),
      }),
      f.app.request(`/api/v1/documents/${f.foreignOtherOrg.document.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({ title: 'escaped' }),
      }),
      f.app.request(`/api/v1/workspaces/${f.otherWorkspace}/share`, {
        method: 'POST',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({ audience_name: 'escaped', mode: 'public' }),
      }),
      f.app.request(`/api/v1/projects/${f.projectA.id}/move`, {
        method: 'POST',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({ workspace_id: f.otherWorkspace }),
      }),
      f.app.request('/api/v1/projects', {
        method: 'POST',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({ name: 'escaped', workspace_id: f.otherWorkspace }),
      }),
      f.app.request(`/api/v1/orgs/${f.otherOrgId}/import`, {
        method: 'POST',
        headers: jsonHeaders(f.ownerKey),
        body: JSON.stringify({}),
      }),
    ]);
    expect(crossOrgWrites.every((response) => response.status === 404)).toBe(true);
    expect(await mutationSnapshot(f.db, f.foreignOtherOrg)).toEqual(before);
    expect((await getProject(f.db, f.projectA.id))?.workspaceId).toBe(f.workspaceA);

    // Legitimate owner-key and session-owner access within org A remains live.
    const ownerSameOrg = await f.app.request(`/api/v1/projects/${f.projectB.id}`, {
      headers: bearer(f.ownerKey),
    });
    const sessionSameOrg = await runWithAuthContext(sessionOwnerContext(f), () =>
      createGetProjectHandler(f.services.projectService)({ project_id: f.projectB.id }),
    );
    const workspaceHappyMcp = await runWithAuthContext(workspaceContext(f), () =>
      Promise.all([
        createGetProjectHandler(f.services.projectService)({ project_id: f.projectA.id }),
        createCreateTaskHandler(f.services.taskService)({
          project_id: f.projectA.id,
          label: 'legitimate MCP task',
        }),
      ]),
    );
    expect(ownerSameOrg.status).toBe(200);
    expect(sessionSameOrg.isError).not.toBe(true);
    expect(workspaceHappyMcp.every((result) => result.isError !== true)).toBe(true);
  });
});
