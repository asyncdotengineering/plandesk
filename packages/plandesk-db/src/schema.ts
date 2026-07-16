import { sql } from 'drizzle-orm';
import {
  blob,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const taskStatuses = ['scope', 'todo', 'in_progress', 'done', 'backlog'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const goalStatuses = ['active', 'paused', 'complete', 'blocked'] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const agentRunStatuses = ['running', 'completed', 'failed'] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const commentTargetTypes = ['document', 'task', 'note', 'submission', 'artifact'] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

export const orgRoles = ['owner', 'manager', 'editor', 'commenter', 'viewer'] as const;
export type OrgRole = (typeof orgRoles)[number];

export const tokenScopes = ['read-only', 'full'] as const;
export type TokenScope = (typeof tokenScopes)[number];

/** Stable id for the single local org; migration backfill uses the same value. */
export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-0000000000a1';

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const orgMembers = sqliteTable(
  'org_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    userRef: text('user_ref').notNull(),
    role: text('role', { enum: orgRoles }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userRef] })],
);

/**
 * Browser sessions minted by the web OAuth redirect flow.
 * Only the hash of the cookie value is stored, so a database dump yields no
 * usable cookie. Rows are deleted on logout — revocation is server-side.
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  userRef: text('user_ref').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const pendingAuth = sqliteTable('pending_auth', {
  authId: text('auth_id').primaryKey(),
  deviceCode: text('device_code').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  name: text('name').notNull(),
  description: text('description'),
  canvasLayout: text('canvas_layout'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  objective: text('objective').notNull(),
  status: text('status', { enum: goalStatuses }).notNull().default('active'),
  verificationSurface: text('verification_surface'),
  constraints: text('constraints'),
  boundaries: text('boundaries'),
  iterationPolicy: text('iteration_policy'),
  stopCondition: text('stop_condition'),
  budget: text('budget'),
  lastVerification: text('last_verification'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  label: text('label').notNull(),
  status: text('status', { enum: taskStatuses }).notNull().default('todo'),
  description: text('description'),
  x: real('x').notNull().default(0),
  y: real('y').notNull().default(0),
  assignee: text('assignee'),
  dueDate: integer('due_date', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const edges = sqliteTable('edges', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  fromTaskId: text('from_task_id')
    .notNull()
    .references(() => tasks.id),
  toTaskId: text('to_task_id')
    .notNull()
    .references(() => tasks.id),
  label: text('label'),
  arrowDirection: text('arrow_direction'),
  style: text('style'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  parentFolderId: text('parent_folder_id').references((): AnySQLiteColumn => folders.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  body: text('body'),
  statusLine: text('status_line'),
  parentId: text('parent_id').references((): AnySQLiteColumn => documents.id),
  folderId: text('folder_id').references(() => folders.id),
  linkedTaskId: text('linked_task_id').references(() => tasks.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  body: text('body'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [uniqueIndex('tags_project_id_name_unique').on(table.projectId, table.name)],
);

export const taskTags = sqliteTable(
  'task_tags',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.tagId] })],
);

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  targetType: text('target_type', { enum: commentTargetTypes }).notNull(),
  targetId: text('target_id').notNull(),
  passage: text('passage'),
  // W3C Web Annotation selector JSON (text-quote + text-position) for artifact
  // annotations that must re-anchor on re-render; null for plain comments.
  anchor: text('anchor'),
  body: text('body').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  status: text('status', { enum: agentRunStatuses }).notNull().default('running'),
  label: text('label'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
});

export const agentRunEvents = sqliteTable('agent_run_events', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => agentRuns.id),
  message: text('message').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const mcpTokens = sqliteTable('mcp_tokens', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  scope: text('scope', { enum: tokenScopes }).notNull().default('full'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

export const shareModes = ['invite', 'public'] as const;
export type ShareMode = (typeof shareModes)[number];

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  audienceName: text('audience_name').notNull(),
  mode: text('mode', { enum: shareModes }).notNull().default('invite'),
  tokenHash: text('token_hash').notNull(),
  permissions: text('permissions').notNull(),
  policy: text('policy').notNull(),
  invitedEmails: text('invited_emails'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

/** Portal guest after named join — scoped to one share/project, no org membership. */
export const guestSessions = sqliteTable(
  'guest_sessions',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id')
      .notNull()
      .references(() => shares.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    email: text('email'),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('guest_sessions_token_hash_unique').on(table.tokenHash)],
);

export const shareSubmissionStatuses = ['pending', 'accepted', 'rejected'] as const;
export type ShareSubmissionStatus = (typeof shareSubmissionStatuses)[number];

export const shareSubmissions = sqliteTable('share_submissions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  hostedShareId: text('hosted_share_id').notNull(),
  participantName: text('participant_name').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  severity: text('severity'),
  taskRef: text('task_ref'),
  status: text('status', { enum: shareSubmissionStatuses }).notNull().default('pending'),
  linkedTaskId: text('linked_task_id').references(() => tasks.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  pulledAt: integer('pulled_at', { mode: 'timestamp_ms' }).notNull(),
});

export const syncState = sqliteTable('sync_state', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  pullCursor: text('pull_cursor'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const artifactKinds = ['markdown', 'html'] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  kind: text('kind', { enum: artifactKinds }).notNull().default('markdown'),
  content: text('content').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const files = sqliteTable(
  'files',
  {
    // Content hash (sha256 hex). PK is (project_id, id) so identical bytes
    // in different projects/orgs never collide; dedup is per-project.
    id: text('id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    bytes: blob('bytes', { mode: 'buffer' }),
    externalUrl: text('external_url'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.id] })],
);

export const syncRemotes = sqliteTable('sync_remotes', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  serverUrl: text('server_url').notNull(),
  globalProjectId: text('global_project_id').notNull(),
  // local-first: outbound credential, not hashed
  syncToken: text('sync_token').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});
