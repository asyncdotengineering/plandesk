import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Vocabularies live in ./vocabulary.ts so a browser bundle can import them
// without drizzle. Re-exported here so every existing `from './schema.js'`
// import keeps working — there is one definition, reachable by two paths.
export {
  taskStatuses,
  taskKinds,
  taskPriorities,
  taskLanes,
  taskSeverities,
  taskPriorityOrder,
  goalStatuses,
  linkEntityTypes,
  taskEdgeLabels,
  documentEdgeLabels,
  edgeLabels,
  DEFAULT_EDGE_LABEL,
  isTaskEdgeLabel,
  isDocumentEdgeLabel,
  type TaskStatus,
  type TaskKind,
  type TaskPriority,
  type TaskLane,
  type TaskSeverity,
  type GoalStatus,
  type LinkEntityType,
  type TaskEdgeLabel,
  type DocumentEdgeLabel,
  type EdgeLabel,
} from './vocabulary.js';

import {
  taskStatuses,
  taskKinds,
  taskPriorities,
  taskLanes,
  taskSeverities,
  goalStatuses,
  linkEntityTypes,
} from './vocabulary.js';

export const agentRunStatuses = ['running', 'completed', 'failed'] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const commentTargetTypes = ['document', 'task', 'note', 'submission', 'artifact'] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

export const revisionTargetTypes = ['task', 'document', 'artifact'] as const;
export type RevisionTargetType = (typeof revisionTargetTypes)[number];

// Edge relationship labels now live in ./vocabulary.ts (re-exported above), split
// into taskEdgeLabels and documentEdgeLabels. The column stays free text.

export const orgRoles = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof orgRoles)[number];

/** Stable id for the single local better-auth organization (loopback owner). */
export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-0000000000a1';
/** Stable id for the single local workspace (the default team of the local org). */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  // Plain scoping column — org identity lives in better-auth organization table.
  orgId: text('org_id').notNull(),
  // NOT NULL scoping column referencing a better-auth team id; default seeds the ADD COLUMN + local single-org boards; real team ids set on create/backfill.
  workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
  name: text('name').notNull(),
  description: text('description'),
  // Nullable — absence is null, never a sentinel. User identity lives in better-auth; no FK.
  ownerId: text('owner_id'),
  // Nullable pin of the project's source-of-truth document. Real FK; same-project
  // ownership is enforced at the service boundary. ON DELETE SET NULL so deleting
  // the overview document clears the pin rather than blocking the delete.
  overviewDocumentId: text('overview_document_id').references((): AnySQLiteColumn => documents.id, {
    onDelete: 'set null',
  }),
  // Nullable repo binding — several projects may share one repo_url (monorepo).
  repoUrl: text('repo_url'),
  // Path relative to the repo root (e.g. packages/plandesk-api); never absolute.
  folderPath: text('folder_path'),
  // Nullable pointer to the goal being worked; see get_next_task resolution order.
  currentGoalId: text('current_goal_id').references((): AnySQLiteColumn => goals.id, {
    onDelete: 'set null',
  }),
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
  name: text('name'),
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
}, (table) => [uniqueIndex('goals_project_id_name_unique').on(table.projectId, table.name)]);

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
  kind: text('kind', { enum: taskKinds }).notNull().default('build'),
  // Nullable — absence is null, never a sentinel like 'none'.
  priority: text('priority', { enum: taskPriorities }),
  lane: text('lane', { enum: taskLanes }),
  severity: text('severity', { enum: taskSeverities }),
  description: text('description'),
  x: real('x').notNull().default(0),
  y: real('y').notNull().default(0),
  assignee: text('assignee'),
  dueDate: integer('due_date', { mode: 'timestamp_ms' }),
  // JSON array of lowercase hex SHAs (7–40 chars). Null when never set / cleared.
  commitRefs: text('commit_refs'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const edges = sqliteTable(
  'edges',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    fromType: text('from_type', { enum: linkEntityTypes }).notNull(),
    fromId: text('from_id').notNull(),
    toType: text('to_type', { enum: linkEntityTypes }).notNull(),
    toId: text('to_id').notNull(),
    label: text('label'),
    arrowDirection: text('arrow_direction'),
    style: text('style'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [
    index('edges_project_from_idx').on(table.projectId, table.fromType, table.fromId),
    index('edges_project_to_idx').on(table.projectId, table.toType, table.toId),
  ],
);

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

/** Project-scoped named list views. Config is JSON {@link SavedViewConfig}. */
export const views = sqliteTable(
  'views',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    /** JSON SavedViewConfig — validated on write via parseSavedViewConfig. */
    config: text('config').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [index('views_project_id_position_idx').on(table.projectId, table.position)],
);

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

export const revisions = sqliteTable(
  'revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    targetType: text('target_type', { enum: revisionTargetTypes }).notNull(),
    targetId: text('target_id').notNull(),
    snapshot: text('snapshot').notNull(),
    changedFields: text('changed_fields').notNull(),
    author: text('author').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (t) => [index('revisions_target_idx').on(t.targetType, t.targetId, t.createdAt)],
);

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

export const shareModes = ['invite', 'public'] as const;
export type ShareMode = (typeof shareModes)[number];

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  // A share is scoped to exactly one project OR one workspace. projectId is
  // null for a workspace share; workspaceId is null for a project share.
  projectId: text('project_id').references(() => projects.id),
  workspaceId: text('workspace_id'),
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

/**
 * Short-lived frame credentials for Moment B (opaque-origin subresources) and
 * portal-guest Moment A. Not shares — never listed with create_share_link.
 * Scoped to prototype ids within one project; random token stored hashed.
 */
export const renderTokens = sqliteTable(
  'render_tokens',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    tokenHash: text('token_hash').notNull(),
    /** JSON string array of prototype ids this credential covers. */
    prototypeIds: text('prototype_ids').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [uniqueIndex('render_tokens_token_hash_unique').on(table.tokenHash)],
);

/** Portal guest after named join — scoped to one share/project, no org membership. */
export const guestSessions = sqliteTable(
  'guest_sessions',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id')
      .notNull()
      .references(() => shares.id),
    // Null for a workspace-scoped guest (workspaceId set instead).
    projectId: text('project_id').references(() => projects.id),
    workspaceId: text('workspace_id'),
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

/**
 * Named flow of screens with a declared viewport. Flat (no nesting).
 * folderId is set on create with the prototype's flow-document folder.
 */
export const prototypes = sqliteTable('prototypes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  viewportWidth: real('viewport_width').notNull(),
  viewportHeight: real('viewport_height').notNull(),
  folderId: text('folder_id').references(() => folders.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  kind: text('kind', { enum: artifactKinds }).notNull().default('markdown'),
  content: text('content').notNull().default(''),
  // Nullable: reports/RFCs have no prototype. Set ⇒ this is a screen ⇒ kind must be html.
  prototypeId: text('prototype_id').references(() => prototypes.id),
  // Position within the prototype's plane; system-owned (canvas layout), not agent-writable.
  x: real('x'),
  y: real('y'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

/**
 * Derived navigation links from screen markup. Recomputed on every content
 * write; never user-editable. toArtifactId null ⇒ unresolved or ambiguous.
 */
export const prototypeLinks = sqliteTable('prototype_links', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  fromArtifactId: text('from_artifact_id')
    .notNull()
    .references(() => artifacts.id),
  toArtifactId: text('to_artifact_id').references(() => artifacts.id),
  rawTarget: text('raw_target').notNull(),
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
