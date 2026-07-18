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
  // Exactly one of projectId / workspaceId is set: a project share carries
  // projectId; a workspace share carries workspaceId with projectId null.
  projectId?: string;
  workspaceId?: string;
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

export async function createShare(db: DbClient, input: CreateShareInput): Promise<CreateShareResult> {
  const id = randomUUID();
  const token = generateShareToken();
  const tokenHash = hashShareToken(token);
  const now = new Date();

  const rows = await db
    .insert(shares)
    .values({
      id,
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
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

export async function getShare(db: DbClient, id: string): Promise<Share | undefined> {
  return db.select().from(shares).where(eq(shares.id, id)).get();
}

export async function getShareByTokenHash(db: DbClient, hash: string): Promise<Share | undefined> {
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
export async function getShareByTokenHashRaw(
  db: DbClient,
  hash: string,
): Promise<Share | undefined> {
  return db.select().from(shares).where(eq(shares.tokenHash, hash)).get();
}

export async function listShares(db: DbClient, projectId: string): Promise<Share[]> {
  return db.select().from(shares).where(eq(shares.projectId, projectId)).all();
}

export async function revokeShare(db: DbClient, id: string): Promise<Share | undefined> {
  const now = new Date();
  const rows = await db
    .update(shares)
    .set({ revokedAt: now })
    .where(and(eq(shares.id, id), isNull(shares.revokedAt)))
    .returning()
    .all();
  return rows[0];
}

export async function deleteSharesByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(shares).where(eq(shares.projectId, projectId)).run();
  return result.rowsAffected;
}

export function parseSharePermissions(share: Share): SharePermissions {
  return JSON.parse(share.permissions) as SharePermissions;
}

export function parseSharePolicy(share: Share): SharePolicy {
  return JSON.parse(share.policy) as SharePolicy;
}
