import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { SyncDbClient } from './db/client.js';
import { hostedShares, syncTokens, type HostedShare } from './db/schema.js';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function verifySyncToken(db: SyncDbClient, raw: string): { id: string } | undefined {
  const tokenHash = hashToken(raw);
  const row = db
    .select({ id: syncTokens.id })
    .from(syncTokens)
    .where(and(eq(syncTokens.tokenHash, tokenHash), isNull(syncTokens.revokedAt)))
    .get();

  return row ?? undefined;
}

export function verifyShareToken(db: SyncDbClient, raw: string): HostedShare | undefined {
  const tokenHash = hashToken(raw);
  const now = new Date();
  const row = db
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

export function createSyncToken(db: SyncDbClient, input: { label: string }): { token: string } {
  const id = randomUUID();
  const token = `plandesk_sync_${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashToken(token);

  db.insert(syncTokens)
    .values({
      id,
      tokenHash,
      label: input.label,
      createdAt: new Date(),
    })
    .run();

  return { token };
}
