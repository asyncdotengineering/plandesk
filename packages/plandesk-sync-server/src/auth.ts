import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { SyncDbClient } from './db/client.js';
import {
  activityLog,
  hostedShares,
  participants,
  syncTokens,
  type HostedShare,
  type Participant,
} from './db/schema.js';

export type ActivityAction = 'join' | 'view' | 'submit' | 'revoke';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function verifySyncToken(
  db: SyncDbClient,
  raw: string,
): Promise<{ id: string } | undefined> {
  const tokenHash = hashToken(raw);
  const row = await db
    .select({ id: syncTokens.id })
    .from(syncTokens)
    .where(and(eq(syncTokens.tokenHash, tokenHash), isNull(syncTokens.revokedAt)))
    .get();

  return row ?? undefined;
}

export async function verifyShareToken(
  db: SyncDbClient,
  raw: string,
): Promise<HostedShare | undefined> {
  const tokenHash = hashToken(raw);
  const now = new Date();
  const row = await db
    .select()
    .from(hostedShares)
    .where(
      and(
        eq(hostedShares.tokenHash, tokenHash),
        isNull(hostedShares.revokedAt),
        or(isNull(hostedShares.expiresAt), gt(hostedShares.expiresAt, now)),
      ),
    )
    .get();

  return row ?? undefined;
}

function isShareActive(share: HostedShare): boolean {
  if (share.revokedAt !== null) {
    return false;
  }
  if (share.expiresAt !== null && share.expiresAt <= new Date()) {
    return false;
  }
  return true;
}

export async function createParticipantSession(
  db: SyncDbClient,
  input: { shareId: string; name: string; email?: string },
): Promise<{ participant: Participant; token: string }> {
  const id = randomUUID();
  const token = `plandesk_pt_${randomBytes(32).toString('base64url')}`;
  const sessionTokenHash = hashToken(token);

  await db
    .insert(participants)
    .values({
      id,
      shareId: input.shareId,
      name: input.name,
      email: input.email ?? null,
      sessionTokenHash,
      createdAt: new Date(),
    })
    .run();

  const participant = await db.select().from(participants).where(eq(participants.id, id)).get();
  if (participant === undefined) {
    throw new Error('failed to create participant');
  }

  return { participant, token };
}

export async function verifyParticipantSession(
  db: SyncDbClient,
  raw: string,
): Promise<{ participant: Participant; share: HostedShare } | undefined> {
  const sessionTokenHash = hashToken(raw);
  const participant = await db
    .select()
    .from(participants)
    .where(and(eq(participants.sessionTokenHash, sessionTokenHash), isNull(participants.revokedAt)))
    .get();

  if (participant === undefined) {
    return undefined;
  }

  const share = await db
    .select()
    .from(hostedShares)
    .where(eq(hostedShares.id, participant.shareId))
    .get();

  if (share === undefined || !isShareActive(share)) {
    return undefined;
  }

  return { participant, share };
}

export async function logActivity(
  db: SyncDbClient,
  input: {
    shareId: string;
    participantId?: string;
    action: ActivityAction;
    detail?: string;
  },
): Promise<void> {
  await db
    .insert(activityLog)
    .values({
      id: randomUUID(),
      shareId: input.shareId,
      participantId: input.participantId ?? null,
      action: input.action,
      detail: input.detail ?? null,
      createdAt: new Date(),
    })
    .run();
}

export async function createSyncToken(
  db: SyncDbClient,
  input: { label: string },
): Promise<{ token: string }> {
  const id = randomUUID();
  const token = `plandesk_sync_${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashToken(token);

  await db
    .insert(syncTokens)
    .values({
      id,
      tokenHash,
      label: input.label,
      createdAt: new Date(),
    })
    .run();

  return { token };
}

/**
 * Seed an owner sync token from a raw token (self-hosted bootstrap). Idempotent:
 * returns false if a token with this hash already exists, true if it was inserted.
 */
export async function seedSyncToken(db: SyncDbClient, rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const existing = await db
    .select({ id: syncTokens.id })
    .from(syncTokens)
    .where(eq(syncTokens.tokenHash, tokenHash))
    .get();
  if (existing !== undefined) {
    return false;
  }
  await db
    .insert(syncTokens)
    .values({ id: randomUUID(), tokenHash, label: 'bootstrap', createdAt: new Date() })
    .run();
  return true;
}
