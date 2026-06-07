import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const taskStatuses = ['scope', 'todo', 'in_progress', 'done', 'backlog'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const agentRunStatuses = ['running', 'completed', 'failed'] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
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

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  body: text('body'),
  statusLine: text('status_line'),
  parentId: text('parent_id').references((): AnySQLiteColumn => documents.id),
  linkedTaskId: text('linked_task_id').references(() => tasks.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export const documentComments = sqliteTable('document_comments', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id),
  passage: text('passage'),
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
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});
