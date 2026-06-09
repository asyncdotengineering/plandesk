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

export type HostedShare = typeof hostedShares.$inferSelect;
