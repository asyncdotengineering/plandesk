import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createToken, listTokens, revokeToken, verifyToken } from './tokens.js';

describe('mcp_tokens repository', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('creates a token with plandesk_mcp_ prefix and stores sha256 only', async () => {
    const { id, name, token } = await createToken(db, { name: 'CI bot' });

    expect(name).toBe('CI bot');
    expect(token).toMatch(/^plandesk_mcp_/);
    expect(id).toBeTruthy();

    const listed = await listTokens(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id,
      name: 'CI bot',
      revoked_at: null,
    });
    expect(typeof listed[0]?.created_at).toBe('string');
    expect(listed[0]).not.toHaveProperty('token');
    expect(listed[0]).not.toHaveProperty('token_hash');

    const row = (
      await db.$client.execute({
        sql: 'SELECT token_hash FROM mcp_tokens WHERE id = ?',
        args: [id],
      })
    ).rows[0];
    expect(row).toBeDefined();
    expect(row?.token_hash).not.toBe(token);
    expect(String(row?.token_hash)).toHaveLength(64);
  });

  it('verifies a valid token', async () => {
    const { token, id } = await createToken(db, { name: 'valid' });
    expect(await verifyToken(db, token)).toEqual({ id, name: 'valid' });
  });

  it('rejects unknown tokens', async () => {
    await createToken(db, { name: 'valid' });
    expect(await verifyToken(db, 'plandesk_mcp_not-a-real-token')).toBeUndefined();
  });

  it('rejects revoked tokens', async () => {
    const { id, token } = await createToken(db, { name: 'revoked' });
    expect(await verifyToken(db, token)).toBeTruthy();

    const revoked = await revokeToken(db, id);
    expect(revoked?.revoked_at).toBeTruthy();
    expect(await verifyToken(db, token)).toBeUndefined();
  });

  it('returns undefined when revoking an unknown token', async () => {
    expect(await revokeToken(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('does not double-revoke a token', async () => {
    const { id } = await createToken(db, { name: 'once' });
    expect(await revokeToken(db, id)).toBeTruthy();
    expect(await revokeToken(db, id)).toBeUndefined();
  });
});
