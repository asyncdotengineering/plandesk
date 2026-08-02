import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { renderTokens } from '../schema.js';

export type RenderToken = typeof renderTokens.$inferSelect;

export const RENDER_TOKEN_PREFIX = 'plandesk_rt_';
/** Default lifetime for a frame credential (Moment B / portal guest). */
export const RENDER_TOKEN_DEFAULT_TTL_MS = 60 * 60 * 1000;

export type CreateRenderTokenInput = {
  orgId: string;
  projectId: string;
  prototypeIds: string[];
  /** Absolute expiry; defaults to now + RENDER_TOKEN_DEFAULT_TTL_MS. */
  expiresAt?: Date;
};

export type CreateRenderTokenResult = {
  row: RenderToken;
  token: string;
};

export function hashRenderToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateRenderToken(): string {
  return `${RENDER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function isRenderToken(raw: string): boolean {
  return raw.startsWith(RENDER_TOKEN_PREFIX);
}

export async function createRenderToken(
  db: DbClient,
  input: CreateRenderTokenInput,
): Promise<CreateRenderTokenResult> {
  const id = randomUUID();
  const token = generateRenderToken();
  const tokenHash = hashRenderToken(token);
  const now = new Date();
  const expiresAt =
    input.expiresAt ?? new Date(now.getTime() + RENDER_TOKEN_DEFAULT_TTL_MS);

  const rows = await db
    .insert(renderTokens)
    .values({
      id,
      orgId: input.orgId,
      projectId: input.projectId,
      tokenHash,
      prototypeIds: JSON.stringify(input.prototypeIds),
      expiresAt,
      createdAt: now,
    })
    .returning()
    .all();

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create render token');
  }
  return { row, token };
}

export async function getRenderTokenByHash(
  db: DbClient,
  hash: string,
): Promise<RenderToken | undefined> {
  const now = new Date();
  return db
    .select()
    .from(renderTokens)
    .where(
      and(
        eq(renderTokens.tokenHash, hash),
        isNull(renderTokens.revokedAt),
        gt(renderTokens.expiresAt, now),
      ),
    )
    .get();
}

export async function revokeRenderToken(db: DbClient, id: string): Promise<void> {
  await db
    .update(renderTokens)
    .set({ revokedAt: new Date() })
    .where(eq(renderTokens.id, id))
    .run();
}

export function parseRenderTokenPrototypeIds(row: RenderToken): string[] {
  const parsed: unknown = JSON.parse(row.prototypeIds);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((id): id is string => typeof id === 'string');
}
