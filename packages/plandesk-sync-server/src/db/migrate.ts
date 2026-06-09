import type { SyncDb } from './client.js';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS sync_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS hosted_shares (
  id TEXT PRIMARY KEY NOT NULL,
  project_global_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  audience_name TEXT NOT NULL,
  permissions TEXT NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);

CREATE UNIQUE INDEX IF NOT EXISTS hosted_shares_token_hash_unique ON hosted_shares (token_hash);

CREATE TABLE IF NOT EXISTS projection_blobs (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  version INTEGER NOT NULL,
  view_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);

CREATE UNIQUE INDEX IF NOT EXISTS projection_blobs_share_id_unique ON projection_blobs (share_id);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  name TEXT NOT NULL,
  email TEXT,
  session_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  revoked_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_session_token_hash_unique ON participants (session_token_hash);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  participant_id TEXT REFERENCES participants(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
`;

export function migrate(db: SyncDb): void {
  db.$client.exec(MIGRATION_SQL);
}
