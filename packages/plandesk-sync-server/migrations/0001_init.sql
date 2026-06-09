CREATE TABLE sync_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  revoked_at INTEGER
);

CREATE TABLE hosted_shares (
  id TEXT PRIMARY KEY NOT NULL,
  project_global_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  audience_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'invite',
  invited_emails TEXT,
  permissions TEXT NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);

CREATE UNIQUE INDEX hosted_shares_token_hash_unique ON hosted_shares (token_hash);

CREATE TABLE projection_blobs (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  version INTEGER NOT NULL,
  view_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);

CREATE UNIQUE INDEX projection_blobs_share_id_unique ON projection_blobs (share_id);

CREATE TABLE participants (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  name TEXT NOT NULL,
  email TEXT,
  session_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  revoked_at INTEGER
);

CREATE UNIQUE INDEX participants_session_token_hash_unique ON participants (session_token_hash);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  participant_id TEXT REFERENCES participants(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT,
  task_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
