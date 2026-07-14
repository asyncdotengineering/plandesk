import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  ensureDefaultOrg,
  migrate,
  verifyToken,
  type Db,
} from '@plandesk/db';
import { createTokenService } from './tokens.js';

describe('tokenService', () => {
  let db: Db;
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    orgId = (await ensureDefaultOrg(db)).id;
    await db.$client.execute('DELETE FROM mcp_tokens');
  });

  it('create returns raw token once with id and name', async () => {
    const service = createTokenService({ db, orgId });
    const created = await service.create('My Token');
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created.name).toBe('My Token');
    expect(created.token).toMatch(/^plandesk_mcp_/);
    expect(await verifyToken(db, created.token)).toEqual({
      id: created.id,
      name: 'My Token',
      orgId,
      scope: 'full',
    });
  });

  it('list omits raw token and hash', async () => {
    const service = createTokenService({ db, orgId });
    const created = await service.create('Listed');
    const tokens = await service.list();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({
      id: created.id,
      name: 'Listed',
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      revoked_at: null,
    });
    expect(tokens[0]).not.toHaveProperty('token');
    expect(tokens[0]).not.toHaveProperty('token_hash');
  });

  it('revoke makes verifyToken fail', async () => {
    const service = createTokenService({ db, orgId });
    const created = await service.create('Revoke me');
    expect(await verifyToken(db, created.token)).toBeTruthy();

    const revoked = await service.revoke(created.id);
    expect(revoked?.revoked_at).toBeTruthy();
    expect(await verifyToken(db, created.token)).toBeUndefined();
  });
});
