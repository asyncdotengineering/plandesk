import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { shares, type ShareMode } from '../schema.js';

export type Share = typeof shares.$inferSelect;

export type SharePermissions = {
  read: boolean;
  submit: boolean;
};

export type SharePolicy = {
  tasks: 'all' | string[];
  documentIds: string[];
  fields: { assignee?: boolean; description?: boolean };
};

export type CreateShareInput = {
  projectId: string;
  audienceName: string;
  mode?: ShareMode;
  permissions: SharePermissions;
  policy: SharePolicy;
  invitedEmails?: string[] | null;
  expiresAt?: Date | null;
};

export type CreateShareResult = {
  share: Share;
  token: string;
};

export function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateShareToken(): string {
  return `plandesk_share_${randomBytes(32).toString('base64url')}`;
}

export function createShare(db: DbClient, input: CreateShareInput): CreateShareResult {
  const id = randomUUID();
  const token = generateShareToken();
  const tokenHash = hashShareToken(token);
  const now = new Date();

  const rows = db
    .insert(shares)
    .values({
      id,
      projectId: input.projectId,
      audienceName: input.audienceName,
      mode: input.mode ?? 'invite',
      tokenHash,
      permissions: JSON.stringify(input.permissions),
      policy: JSON.stringify(input.policy),
      invitedEmails:
        input.invitedEmails !== undefined && input.invitedEmails !== null
          ? JSON.stringify(input.invitedEmails)
          : null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
    })
    .returning()
    .all();

  const share = rows[0];
  if (!share) {
    throw new Error('Failed to create share');
  }

  return { share, token };
}

export function getShare(db: DbClient, id: string): Share | undefined {
  return db.select().from(shares).where(eq(shares.id, id)).get();
}

export function getShareByTokenHash(db: DbClient, hash: string): Share | undefined {
  const now = new Date();
  return db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.tokenHash, hash),
        isNull(shares.revokedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, now)),
      ),
    )
    .get();
}

// Unlike getShareByTokenHash, does not filter out revoked/expired shares — callers
// that need to distinguish "unknown token" (404) from "revoked/expired" (410) use this.
export function getShareByTokenHashRaw(db: DbClient, hash: string): Share | undefined {
  return db.select().from(shares).where(eq(shares.tokenHash, hash)).get();
}

export function listShares(db: DbClient, projectId: string): Share[] {
  return db.select().from(shares).where(eq(shares.projectId, projectId)).all();
}

export function revokeShare(db: DbClient, id: string): Share | undefined {
  const now = new Date();
  const rows = db
    .update(shares)
    .set({ revokedAt: now })
    .where(and(eq(shares.id, id), isNull(shares.revokedAt)))
    .returning()
    .all();
  return rows[0];
}

export function deleteSharesByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(shares).where(eq(shares.projectId, projectId)).run();
  return result.changes;
}

export function parseSharePermissions(share: Share): SharePermissions {
  return JSON.parse(share.permissions) as SharePermissions;
}

export function parseSharePolicy(share: Share): SharePolicy {
  return JSON.parse(share.policy) as SharePolicy;
}
