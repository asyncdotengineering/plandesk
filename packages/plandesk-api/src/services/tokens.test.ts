import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrate, verifyToken , type Db} from '@plandesk/db';
import { createTokenService } from './tokens.js';

describe('tokenService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    await db.$client.execute('DELETE FROM mcp_tokens');
  });

  it('create returns raw token once with id and name', async () => {
    const service = createTokenService({ db });
    const created = await service.create('My Token');
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created.name).toBe('My Token');
    expect(created.token).toMatch(/^plandesk_mcp_/);
    expect(await verifyToken(db, created.token)).toEqual({ id: created.id, name: 'My Token' });
  });

  it('list omits raw token and hash', async () => {
    const service = createTokenService({ db });
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
    const service = createTokenService({ db });
    const created = await service.create('Revoke me');
    expect(await verifyToken(db, created.token)).toBeTruthy();

    const revoked = await service.revoke(created.id);
    expect(revoked).toMatchObject({
      id: created.id,
      name: 'Revoke me',
      revoked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
    });
    expect(await verifyToken(db, created.token)).toBeUndefined();
  });

  it('revoke returns undefined for missing or already revoked token', async () => {
    const service = createTokenService({ db });
    const created = await service.create('Once');
    expect((await service.revoke(created.id))?.id).toBe(created.id);
    expect(await service.revoke(created.id)).toBeUndefined();
    expect(await service.revoke('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });
});
