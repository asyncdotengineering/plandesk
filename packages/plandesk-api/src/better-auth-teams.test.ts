import { describe, expect, it } from 'vitest';
import { createDb, createProject, migrate, DEFAULT_WORKSPACE_ID } from '@plandesk/db';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import {
  ensureDefaultTeamForOrg,
  backfillDefaultTeams,
  backfillProjectWorkspaces,
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

type BetterAuthOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
};

type BetterAuthMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

type TeamRow = {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
};

type TeamMemberRow = {
  id: string;
  teamId: string;
  userId: string;
  createdAt: Date;
};

async function seedUserAndOrg(
  auth: BetterAuthInstance,
  opts: {
    orgId: string;
    orgName: string;
    orgSlug: string;
    userName: string;
    userEmail: string;
    githubAccountId: string;
    role: string;
  },
): Promise<{ userId: string }> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: opts.userName,
      email: opts.userEmail,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthAccount>({
    model: 'account',
    data: {
      accountId: opts.githubAccountId,
      providerId: 'github',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  const orgData = {
    id: opts.orgId,
    name: opts.orgName,
    slug: opts.orgSlug,
    createdAt: now,
  };
  await adapter.create<BetterAuthOrganization>({
    model: 'organization',
    data: orgData,
    forceAllowId: true,
  });
  await adapter.create<BetterAuthMember>({
    model: 'member',
    data: {
      organizationId: opts.orgId,
      userId: user.id,
      role: opts.role,
      createdAt: now,
    },
  });
  return { userId: user.id };
}

async function seedMember(
  auth: BetterAuthInstance,
  opts: {
    orgId: string;
    userName: string;
    userEmail: string;
    githubAccountId: string;
    role: string;
  },
): Promise<{ userId: string }> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: opts.userName,
      email: opts.userEmail,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthAccount>({
    model: 'account',
    data: {
      accountId: opts.githubAccountId,
      providerId: 'github',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthMember>({
    model: 'member',
    data: {
      organizationId: opts.orgId,
      userId: user.id,
      role: opts.role,
      createdAt: now,
    },
  });
  return { userId: user.id };
}

describe('better-auth teams (workspace foundation)', () => {
  async function setupAuth(): Promise<BetterAuthInstance> {
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    return auth;
  }

  it('team and teamMember tables exist after teams-enabled migration', async () => {
    const auth = await setupAuth();
    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const user = await adapter.create<BetterAuthUser>({
      model: 'user',
      data: {
        name: 'Test',
        email: 'test@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const orgData = {
      id: 'test-org',
      name: 'Test Org',
      slug: 'test-org',
      createdAt: now,
    };
    await adapter.create<BetterAuthOrganization>({
      model: 'organization',
      data: orgData,
      forceAllowId: true,
    });
    const team = await adapter.create<TeamRow>({
      model: 'team',
      data: {
        name: 'Test Team',
        organizationId: 'test-org',
        createdAt: now,
      },
    });
    expect(team.id).toBeDefined();
    const teamMember = await adapter.create<TeamMemberRow>({
      model: 'teamMember',
      data: {
        teamId: team.id,
        userId: user.id,
        createdAt: now,
      },
    });
    expect(teamMember.id).toBeDefined();
  });

  it('ensureDefaultTeamForOrg creates a General team and adds members; second call is idempotent', async () => {
    const auth = await setupAuth();
    const orgId = 'org-1';
    await seedUserAndOrg(auth, {
      orgId,
      orgName: 'Test Org',
      orgSlug: 'test-org',
      userName: 'Alice',
      userEmail: 'alice@example.com',
      githubAccountId: '1001',
      role: 'owner',
    });
    await seedMember(auth, {
      orgId,
      userName: 'Bob',
      userEmail: 'bob@example.com',
      githubAccountId: '1002',
      role: 'member',
    });

    const teamId = await ensureDefaultTeamForOrg(auth, orgId);
    const adapter = (await auth.$context).adapter;
    const teams = await adapter.findMany<TeamRow>({
      model: 'team',
      where: [{ field: 'organizationId', value: orgId }],
    });
    expect(teams.length).toBe(1);
    expect(teams[0]!.name).toBe('General');

    const teamMembers = await adapter.findMany<TeamMemberRow>({
      model: 'teamMember',
      where: [{ field: 'teamId', value: teamId }],
    });
    expect(teamMembers.length).toBe(2);

    const second = await ensureDefaultTeamForOrg(auth, orgId);
    expect(second).toBe(teamId);

    const teamsAfter = await adapter.findMany<TeamRow>({
      model: 'team',
      where: [{ field: 'organizationId', value: orgId }],
    });
    expect(teamsAfter.length).toBe(1);

    const teamMembersAfter = await adapter.findMany<TeamMemberRow>({
      model: 'teamMember',
      where: [{ field: 'teamId', value: teamId }],
    });
    expect(teamMembersAfter.length).toBe(2);
  });

  it('backfillDefaultTeams creates a team for an org without one and is a no-op on second run', async () => {
    const auth = await setupAuth();
    const orgA = { id: 'org-a', name: 'Org A', slug: 'org-a' };
    const orgB = { id: 'org-b', name: 'Org B', slug: 'org-b' };
    await seedUserAndOrg(auth, {
      orgId: orgA.id,
      orgName: orgA.name,
      orgSlug: orgA.slug,
      userName: 'Alice',
      userEmail: 'alice@example.com',
      githubAccountId: '1001',
      role: 'owner',
    });
    await seedUserAndOrg(auth, {
      orgId: orgB.id,
      orgName: orgB.name,
      orgSlug: orgB.slug,
      userName: 'Bob',
      userEmail: 'bob@example.com',
      githubAccountId: '1002',
      role: 'owner',
    });

    const first = await backfillDefaultTeams(auth);
    expect(first.orgsProcessed).toBe(2);
    expect(first.teamsCreated).toBe(2);

    const second = await backfillDefaultTeams(auth);
    expect(second.orgsProcessed).toBe(2);
    expect(second.teamsCreated).toBe(0);
  });

  it('backfillProjectWorkspaces sets workspace_id to the org default team and is idempotent', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const orgId = 'org-1';
    await seedUserAndOrg(auth, {
      orgId,
      orgName: 'Test Org',
      orgSlug: 'test-org',
      userName: 'Alice',
      userEmail: 'alice@example.com',
      githubAccountId: '1001',
      role: 'owner',
    });

    const teamId = await ensureDefaultTeamForOrg(auth, orgId);
    const project = await createProject(db, {
      name: 'Legacy',
      orgId,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });

    const first = await backfillProjectWorkspaces(db, auth);
    expect(first.projectsUpdated).toBe(1);

    const updated = await db.$client.execute({
      sql: 'SELECT workspace_id FROM projects WHERE id = ?',
      args: [project.id],
    });
    expect((updated.rows[0] as unknown as { workspace_id: string }).workspace_id).toBe(teamId);

    const second = await backfillProjectWorkspaces(db, auth);
    expect(second.projectsUpdated).toBe(0);
  });
});
