import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { mcpTokens } from '../schema.js';

export type McpToken = typeof mcpTokens.$inferSelect;

export type McpTokenPublic = {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
};

export type CreateTokenResult = {
  id: string;
  name: string;
  token: string;
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
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

export async function createToken(
  db: DbClient,
  input: { name: string },
): Promise<CreateTokenResult> {
  const id = randomUUID();
  const token = generateRawToken();
  const tokenHash = hashToken(token);
  const now = new Date();

  await db
    .insert(mcpTokens)
    .values({
      id,
      name: input.name,
      tokenHash,
      createdAt: now,
    })
    .run();

  return { id, name: input.name, token };
}

export async function verifyToken(
  db: DbClient,
  raw: string,
): Promise<{ id: string; name: string } | undefined> {
  const tokenHash = hashToken(raw);
  const row = await db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenHash, tokenHash), isNull(mcpTokens.revokedAt)))
    .get();

  if (!row) {
    return undefined;
  }

  return { id: row.id, name: row.name };
}

export async function listTokens(db: DbClient): Promise<McpTokenPublic[]> {
  const rows = await db.select().from(mcpTokens).all();
  return rows.map(toPublic);
}

export async function revokeToken(db: DbClient, id: string): Promise<McpTokenPublic | undefined> {
  const now = new Date();
  const rows = await db
    .update(mcpTokens)
    .set({ revokedAt: now })
    .where(and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt)))
    .returning()
    .all();

  const row = rows[0];
  return row ? toPublic(row) : undefined;
}
