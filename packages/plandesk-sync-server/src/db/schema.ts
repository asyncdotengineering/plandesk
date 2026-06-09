import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// TODO(phase6): every table will gain org_id for tenant scoping.

export const syncTokens = sqliteTable('sync_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  label: text('label').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

export const hostedShares = sqliteTable(
  'hosted_shares',
  {
    id: text('id').primaryKey(),
    projectGlobalId: text('project_global_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    audienceName: text('audience_name').notNull(),
    mode: text('mode').notNull().default('invite'),
    invitedEmails: text('invited_emails'),
    permissions: text('permissions').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [uniqueIndex('hosted_shares_token_hash_unique').on(table.tokenHash)],
);

export const projectionBlobs = sqliteTable(
  'projection_blobs',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id')
      .notNull()
      .references(() => hostedShares.id),
    version: integer('version').notNull(),
    viewJson: text('view_json').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
  },
  (table) => [uniqueIndex('projection_blobs_share_id_unique').on(table.shareId)],
);

export const participants = sqliteTable(
  'participants',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id')
      .notNull()
      .references(() => hostedShares.id),
    name: text('name').notNull(),
    email: text('email'),
    sessionTokenHash: text('session_token_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('participants_session_token_hash_unique').on(table.sessionTokenHash)],
);

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  shareId: text('share_id')
    .notNull()
    .references(() => hostedShares.id),
  participantId: text('participant_id').references(() => participants.id),
  action: text('action').notNull(),
  detail: text('detail'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`),
});

export type HostedShare = typeof hostedShares.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
