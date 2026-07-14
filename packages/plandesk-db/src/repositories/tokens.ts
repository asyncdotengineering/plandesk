import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { mcpTokens, type TokenScope } from '../schema.js';

export type McpToken = typeof mcpTokens.$inferSelect;

export type McpTokenPublic = {
  id: string;
  name: string;
  scope: TokenScope;
  created_at: string;
  revoked_at: string | null;
};

export type CreateTokenResult = {
  id: string;
  name: string;
  scope: TokenScope;
  token: string;
};

export type VerifiedToken = {
  id: string;
  name: string;
  orgId: string;
  scope: TokenScope;
};

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawToken(): string {
  return `plandesk_mcp_${randomBytes(32).toString('base64url')}`;
}

function toPublic(row: McpToken): McpTokenPublic {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

export async function createToken(
  db: DbClient,
  input: { name: string; orgId: string; scope?: TokenScope },
): Promise<CreateTokenResult> {
  const id = randomUUID();
  const token = generateRawToken();
  const tokenHash = hashToken(token);
  const scope = input.scope ?? 'full';
  const now = new Date();

  await db
    .insert(mcpTokens)
    .values({
      id,
      orgId: input.orgId,
      name: input.name,
      tokenHash,
      scope,
      createdAt: now,
    })
    .run();

  return { id, name: input.name, scope, token };
}

export async function verifyToken(
  db: DbClient,
  raw: string,
): Promise<VerifiedToken | undefined> {
  const tokenHash = hashToken(raw);
  const row = await db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenHash, tokenHash), isNull(mcpTokens.revokedAt)))
    .get();

  if (!row) {
    return undefined;
  }

  return { id: row.id, name: row.name, orgId: row.orgId, scope: row.scope };
}

export async function listTokens(
  db: DbClient,
  orgId: string,
): Promise<McpTokenPublic[]> {
  const rows = await db.select().from(mcpTokens).where(eq(mcpTokens.orgId, orgId)).all();
  return rows.map(toPublic);
}

export async function revokeToken(
  db: DbClient,
  id: string,
  orgId?: string,
): Promise<McpTokenPublic | undefined> {
  const now = new Date();
  const condition =
    orgId === undefined
      ? and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt))
      : and(eq(mcpTokens.id, id), eq(mcpTokens.orgId, orgId), isNull(mcpTokens.revokedAt));
  const rows = await db
    .update(mcpTokens)
    .set({ revokedAt: now })
    .where(condition)
    .returning()
    .all();

  const row = rows[0];
  return row ? toPublic(row) : undefined;
}
