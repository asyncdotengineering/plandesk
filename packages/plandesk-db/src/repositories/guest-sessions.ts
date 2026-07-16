import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { guestSessions, shares } from '../schema.js';
import type { Share } from './shares.js';

export type GuestSession = typeof guestSessions.$inferSelect;

export type CreateGuestSessionResult = {
  guest: GuestSession;
  /** Raw token — returned once at mint; only its hash is stored. */
  token: string;
};

export type VerifiedGuestSession = {
  id: string;
  shareId: string;
  projectId: string;
  name: string;
  email: string | null;
  share: Share;
};

function hashGuestToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateGuestToken(): string {
  return `plandesk_guest_${randomBytes(32).toString('base64url')}`;
}

export async function createGuestSession(
  db: DbClient,
  input: { shareId: string; projectId: string; name: string; email?: string },
): Promise<CreateGuestSessionResult> {
  const id = randomUUID();
  const token = generateGuestToken();
  const now = new Date();

  const rows = await db
    .insert(guestSessions)
    .values({
      id,
      shareId: input.shareId,
      projectId: input.projectId,
      name: input.name,
      email: input.email ?? null,
      tokenHash: hashGuestToken(token),
      createdAt: now,
    })
    .returning()
    .all();

  const guest = rows[0];
  if (guest === undefined) {
    throw new Error('Failed to create guest session');
  }

  return { guest, token };
}

/** Resolve a raw guest token to a live, non-revoked session with its share. */
export async function verifyGuestSession(
  db: DbClient,
  raw: string,
): Promise<VerifiedGuestSession | undefined> {
  const guest = await db
    .select()
    .from(guestSessions)
    .where(and(eq(guestSessions.tokenHash, hashGuestToken(raw)), isNull(guestSessions.revokedAt)))
    .get();

  if (guest === undefined) {
    return undefined;
  }

  return attachShareIfLive(db, guest);
}

/** Load a guest session by id when already verified via AuthContext. */
export async function getGuestSessionById(
  db: DbClient,
  id: string,
): Promise<VerifiedGuestSession | undefined> {
  const guest = await db
    .select()
    .from(guestSessions)
    .where(and(eq(guestSessions.id, id), isNull(guestSessions.revokedAt)))
    .get();

  if (guest === undefined) {
    return undefined;
  }

  return attachShareIfLive(db, guest);
}

async function attachShareIfLive(
  db: DbClient,
  guest: GuestSession,
): Promise<VerifiedGuestSession | undefined> {
  const share = await db.select().from(shares).where(eq(shares.id, guest.shareId)).get();
  if (share === undefined) {
    return undefined;
  }

  const now = new Date();
  if (share.revokedAt !== null || (share.expiresAt !== null && share.expiresAt <= now)) {
    return undefined;
  }

  return {
    id: guest.id,
    shareId: guest.shareId,
    projectId: guest.projectId,
    name: guest.name,
    email: guest.email,
    share,
  };
}

export async function revokeGuestSession(db: DbClient, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(guestSessions)
    .set({ revokedAt: now })
    .where(and(eq(guestSessions.id, id), isNull(guestSessions.revokedAt)))
    .returning()
    .all();
  return rows.length > 0;
}
