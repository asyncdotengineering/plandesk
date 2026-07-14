import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { sessions } from '../schema.js';

export type Session = typeof sessions.$inferSelect;

export type CreateSessionResult = {
  id: string;
  orgId: string;
  userRef: string;
  expiresAt: Date;
  /** Raw cookie value — returned once at mint time; only its hash is stored. */
  token: string;
};

export type VerifiedSession = {
  id: string;
  orgId: string;
  userRef: string;
  expiresAt: Date;
};

/** 30 days — long enough to be useful, short enough to bound a stolen cookie. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashSessionToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawToken(): string {
  return `plandesk_sess_${randomBytes(32).toString('base64url')}`;
}

export async function createSession(
  db: DbClient,
  input: { orgId: string; userRef: string; now?: Date; ttlMs?: number },
): Promise<CreateSessionResult> {
  const id = randomUUID();
  const token = generateRawToken();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? SESSION_TTL_MS));

  await db
    .insert(sessions)
    .values({
      id,
      orgId: input.orgId,
      userRef: input.userRef,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt,
    })
    .run();

  return { id, orgId: input.orgId, userRef: input.userRef, expiresAt, token };
}

/** Resolve a raw cookie value to a live session. Expired rows never verify. */
export async function verifySession(
  db: DbClient,
  raw: string,
  now: Date = new Date(),
): Promise<VerifiedSession | undefined> {
  const row = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashSessionToken(raw)), gt(sessions.expiresAt, now)))
    .get();

  if (!row) {
    return undefined;
  }
  return { id: row.id, orgId: row.orgId, userRef: row.userRef, expiresAt: row.expiresAt };
}

/**
 * Destroy a session server-side. Deleting the row is the revocation: a cookie
 * captured before logout no longer resolves to anything.
 */
export async function deleteSession(db: DbClient, raw: string): Promise<boolean> {
  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(raw)))
    .returning()
    .all();
  return deleted.length > 0;
}
