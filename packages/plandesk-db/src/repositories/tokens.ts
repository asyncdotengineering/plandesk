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

export function createToken(db: DbClient, input: { name: string }): CreateTokenResult {
  const id = randomUUID();
  const token = generateRawToken();
  const tokenHash = hashToken(token);
  const now = new Date();

  db.insert(mcpTokens)
    .values({
      id,
      name: input.name,
      tokenHash,
      createdAt: now,
    })
    .run();

  return { id, name: input.name, token };
}

export function verifyToken(db: DbClient, raw: string): { id: string; name: string } | undefined {
  const tokenHash = hashToken(raw);
  const row = db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenHash, tokenHash), isNull(mcpTokens.revokedAt)))
    .get();

  if (!row) {
    return undefined;
  }

  return { id: row.id, name: row.name };
}

export function listTokens(db: DbClient): McpTokenPublic[] {
  return db.select().from(mcpTokens).all().map(toPublic);
}

export function revokeToken(db: DbClient, id: string): McpTokenPublic | undefined {
  const now = new Date();
  const rows = db
    .update(mcpTokens)
    .set({ revokedAt: now })
    .where(and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt)))
    .returning()
    .all();

  const row = rows[0];
  return row ? toPublic(row) : undefined;
}
