import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createToken, listTokens, revokeToken, verifyToken } from './tokens.js';

describe('mcp_tokens repository', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM mcp_tokens');
  });

  it('creates a token with plandesk_mcp_ prefix and stores sha256 only', () => {
    const { id, name, token } = createToken(db, { name: 'CI bot' });

    expect(name).toBe('CI bot');
    expect(token).toMatch(/^plandesk_mcp_/);
    expect(id).toBeTruthy();

    const listed = listTokens(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id,
      name: 'CI bot',
      revoked_at: null,
    });
    expect(typeof listed[0]?.created_at).toBe('string');
    expect(listed[0]).not.toHaveProperty('token');
    expect(listed[0]).not.toHaveProperty('token_hash');

    const row = db.$client.prepare('SELECT token_hash FROM mcp_tokens WHERE id = ?').get(id) as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64);
  });

  it('verifies a valid token', () => {
    const { token, id } = createToken(db, { name: 'valid' });
    expect(verifyToken(db, token)).toEqual({ id, name: 'valid' });
  });

  it('rejects unknown tokens', () => {
    createToken(db, { name: 'valid' });
    expect(verifyToken(db, 'plandesk_mcp_not-a-real-token')).toBeUndefined();
  });

  it('rejects revoked tokens', () => {
    const { id, token } = createToken(db, { name: 'revoked' });
    expect(verifyToken(db, token)).toBeTruthy();

    const revoked = revokeToken(db, id);
    expect(revoked?.revoked_at).toBeTruthy();
    expect(verifyToken(db, token)).toBeUndefined();
  });

  it('returns undefined when revoking an unknown token', () => {
    expect(revokeToken(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('does not double-revoke a token', () => {
    const { id } = createToken(db, { name: 'once' });
    expect(revokeToken(db, id)).toBeTruthy();
    expect(revokeToken(db, id)).toBeUndefined();
  });
});
