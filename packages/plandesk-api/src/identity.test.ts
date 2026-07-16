import { describe, expect, it } from 'vitest';
import { createDb, DEFAULT_ORG_ID, migrate } from '@plandesk/db';
import { createBetterAuth, runBetterAuthMigrations } from './better-auth.js';
import { createApp } from './server.js';
import {
  ensureLocalBetterAuthOrganization,
  githubAccountIdFromUserRef,
  resolveOrganizationsForGithubIdentity,
  userRefFromGithubAccountId,
} from './identity.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

type BetterAuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BetterAuthAccount = {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};

type BetterAuthMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

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
    expect(githubAccountIdFromUserRef('github:583231')).toBe('583231');
    expect(githubAccountIdFromUserRef('github:renamable-login')).toBeUndefined();
    expect(githubAccountIdFromUserRef('google:583231')).toBeUndefined();
  });

  it('returns zero orgs and creates nothing for a brand-new GitHub identity (REQ-3)', async () => {
    const { auth } = await setup();
    const adapter = (await auth.$context).adapter;

    await expect(
      resolveOrganizationsForGithubIdentity(auth, {
        id: 583231,
        login: 'new-user',
        name: 'New User',
      }),
    ).resolves.toEqual([]);

    await expect(adapter.count({ model: 'user' })).resolves.toBe(0);
    await expect(adapter.count({ model: 'organization' })).resolves.toBe(0);
    await expect(adapter.count({ model: 'member' })).resolves.toBe(0);
  });

  it('resolves organizations through GitHub account to user membership', async () => {
    const { auth } = await setup();
    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const user = await adapter.create<BetterAuthUser>({
      model: 'user',
      data: {
        name: 'Member',
        email: 'member@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create<BetterAuthAccount>({
      model: 'account',
      data: {
        accountId: '583231',
        providerId: 'github',
        userId: user.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    const organization = await adapter.create<{
      id: string;
      name: string;
      slug: string;
      createdAt: Date;
    }>({
      model: 'organization',
      data: { name: 'Acme', slug: 'acme', createdAt: now },
    });
    await adapter.create<BetterAuthMember>({
      model: 'member',
      data: { organizationId: organization.id, userId: user.id, role: 'member', createdAt: now },
    });

    await expect(
      resolveOrganizationsForGithubIdentity(auth, {
        id: 583231,
        login: 'renamed-login',
        name: 'Member',
      }),
    ).resolves.toEqual([{ id: organization.id, name: 'Acme', slug: 'acme', role: 'member' }]);
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
    });
  });
});
