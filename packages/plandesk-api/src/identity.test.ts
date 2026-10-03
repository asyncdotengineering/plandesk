import { describe, expect, it } from 'vitest';
import { createDb, DEFAULT_ORG_ID, migrate } from '@plandesk/db';
import { createBetterAuth, runBetterAuthMigrations } from './better-auth.js';
import { createApp } from './server.js';
import { ensureLocalBetterAuthOrganization, userRefFromGithubAccountId } from './identity.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

async function setup() {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);
  return { db, auth };
}

describe('better-auth identity resolution', () => {
  it('maps only numeric stable GitHub account IDs to legacy user_ref values', () => {
    expect(userRefFromGithubAccountId('583231')).toBe('github:583231');
  });
});

describe('local identity foundation', () => {
  it('seeds a user-less Better Auth org while loopback remains legacy owner auth (REQ-4, REQ-21)', async () => {
    const { db, auth } = await setup();
    const org = await ensureLocalBetterAuthOrganization(db, auth);
    const adapter = (await auth.$context).adapter;

    expect(org.id).toBe(DEFAULT_ORG_ID);
    await expect(
      adapter.findOne<{ id: string; name: string; slug: string }>({
        model: 'organization',
        where: [{ field: 'id', value: DEFAULT_ORG_ID }],
      }),
    ).resolves.toMatchObject({ id: DEFAULT_ORG_ID, name: 'Personal', slug: 'local' });
    await expect(adapter.count({ model: 'user' })).resolves.toBe(0);
    await expect(adapter.count({ model: 'member' })).resolves.toBe(0);

    const response = await createApp({ db, bindHost: '127.0.0.1' }).request('/api/v1/auth/session');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: 'loopback',
      user_ref: null,
      role: 'owner',
      org: { id: DEFAULT_ORG_ID, name: 'Personal' },
      orgs: [{ id: DEFAULT_ORG_ID, name: 'Personal', role: 'owner' }],
      active_workspace: null,
      workspaces: [],
    });
  });
});
