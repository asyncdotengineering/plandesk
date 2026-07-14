import { describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { ensureDefaultOrg } from './orgs.js';
import { createSession, deleteSession, verifySession, SESSION_TTL_MS } from './sessions.js';

async function setup(): Promise<{ db: Db; orgId: string }> {
  const db = await createDb(':memory:');
  await migrate(db);
  const org = await ensureDefaultOrg(db);
  return { db, orgId: org.id };
}

describe('sessions repository', () => {
  it('verifies a freshly minted session token', async () => {
    const { db, orgId } = await setup();
    const created = await createSession(db, { orgId, userRef: 'github:42' });

    const verified = await verifySession(db, created.token);
    expect(verified).toBeDefined();
    expect(verified?.orgId).toBe(orgId);
    expect(verified?.userRef).toBe('github:42');
    expect(verified?.id).toBe(created.id);
  });

  it('stores only the hash — the raw token never lands in the table', async () => {
    const { db, orgId } = await setup();
    const created = await createSession(db, { orgId, userRef: 'github:42' });

    const rows = await db.$client.execute('SELECT token_hash FROM sessions');
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0]?.token_hash)).not.toBe(created.token);
    expect(String(rows.rows[0]?.token_hash)).toHaveLength(64);
  });

  it('does not verify an unknown token', async () => {
    const { db, orgId } = await setup();
    await createSession(db, { orgId, userRef: 'github:42' });

    expect(await verifySession(db, 'plandesk_sess_nope')).toBeUndefined();
  });

  it('does not verify an expired session', async () => {
    const { db, orgId } = await setup();
    const past = new Date(Date.now() - SESSION_TTL_MS - 1000);
    const created = await createSession(db, { orgId, userRef: 'github:42', now: past });

    expect(await verifySession(db, created.token)).toBeUndefined();
  });

  it('deleteSession revokes server-side — a replayed token stops verifying', async () => {
    const { db, orgId } = await setup();
    const created = await createSession(db, { orgId, userRef: 'github:42' });
    expect(await verifySession(db, created.token)).toBeDefined();

    expect(await deleteSession(db, created.token)).toBe(true);
    expect(await verifySession(db, created.token)).toBeUndefined();
    expect(await deleteSession(db, created.token)).toBe(false);
  });

  it('mints distinct tokens for two sessions of the same user', async () => {
    const { db, orgId } = await setup();
    const first = await createSession(db, { orgId, userRef: 'github:42' });
    const second = await createSession(db, { orgId, userRef: 'github:42' });

    expect(first.token).not.toBe(second.token);
    expect((await verifySession(db, first.token))?.orgId).toBe(orgId);
    expect((await verifySession(db, second.token))?.orgId).toBe(orgId);
  });
});
