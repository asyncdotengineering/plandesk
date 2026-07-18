import { DEFAULT_ORG_ID, type Db } from '@plandesk/db';
import type { BetterAuthInstance } from './better-auth.js';
import type { GithubIdentity } from './github.js';
import { getOrganizationById, type OrganizationSummary } from './organizations.js';

const GITHUB_PROVIDER_ID = 'github';
const GITHUB_USER_REF_PREFIX = 'github:';
const NUMERIC_GITHUB_ID = /^[1-9]\d*$/;

type AccountRow = {
  accountId: string;
  providerId: string;
  userId: string;
};

type UserRow = { id: string; name: string };

type MemberRow = {
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

type SessionRow = {
  token: string;
  userId: string;
  activeOrganizationId?: string | null;
  updatedAt: Date;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
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

export type IdentityOrganization = Pick<OrganizationRow, 'id' | 'name' | 'slug'> & {
  role: string;
};

export function githubAccountIdFromUserRef(userRef: string): string | undefined {
  if (!userRef.startsWith(GITHUB_USER_REF_PREFIX)) return undefined;
  const accountId = userRef.slice(GITHUB_USER_REF_PREFIX.length);
  return NUMERIC_GITHUB_ID.test(accountId) ? accountId : undefined;
}

export function userRefFromGithubAccountId(accountId: string): string {
  if (!NUMERIC_GITHUB_ID.test(accountId)) {
    throw new Error('GitHub account id must be numeric');
  }
  return `${GITHUB_USER_REF_PREFIX}${accountId}`;
}

export async function resolveOrganizationsForGithubIdentity(
  auth: BetterAuthInstance,
  identity: GithubIdentity,
): Promise<IdentityOrganization[]> {
  const adapter = (await auth.$context).adapter;
  const account = await adapter.findOne<AccountRow>({
    model: 'account',
    where: [
      { field: 'providerId', value: GITHUB_PROVIDER_ID },
      { field: 'accountId', value: String(identity.id) },
    ],
  });
  if (account === null) return [];

  const user = await adapter.findOne<UserRow>({
    model: 'user',
    where: [{ field: 'id', value: account.userId }],
  });
  if (user === null) throw new Error('GitHub account points to a missing user');

  const members = await adapter.findMany<MemberRow>({
    model: 'member',
    where: [{ field: 'userId', value: user.id }],
    sortBy: { field: 'createdAt', direction: 'asc' },
  });

  return Promise.all(
    members.map(async (member) => {
      const organization = await adapter.findOne<OrganizationRow>({
        model: 'organization',
        where: [{ field: 'id', value: member.organizationId }],
      });
      if (organization === null) throw new Error('Membership points to a missing organization');
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: member.role,
      };
    }),
  );
}

/**
 * Ensure the well-known local better-auth organization exists (user-less).
 * Idempotent. Used at serve boot for loopback owner-by-bind.
 */
export async function ensureDefaultTeamForOrg(
  auth: BetterAuthInstance,
  organizationId: string,
  _orgName?: string,
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const existingTeams = await adapter.findMany<TeamRow>({
    model: 'team',
    where: [{ field: 'organizationId', value: organizationId }],
  });
  let team: TeamRow;
  if (existingTeams.length > 0) {
    team = existingTeams[0]!;
  } else {
    const now = new Date();
    team = await adapter.create<TeamRow>({
      model: 'team',
      data: {
        name: 'General',
        organizationId,
        createdAt: now,
      },
    });
  }

  const members = await adapter.findMany<MemberRow>({
    model: 'member',
    where: [{ field: 'organizationId', value: organizationId }],
  });
  const existingTeamMembers = await adapter.findMany<TeamMemberRow>({
    model: 'teamMember',
    where: [{ field: 'teamId', value: team.id }],
  });
  const userIdsInTeam = new Set(existingTeamMembers.map((tm) => tm.userId));
  const now = new Date();
  for (const member of members) {
    if (!userIdsInTeam.has(member.userId)) {
      await adapter.create<TeamMemberRow>({
        model: 'teamMember',
        data: {
          teamId: team.id,
          userId: member.userId,
          createdAt: now,
        },
      });
    }
  }
  return team.id;
}

export async function backfillDefaultTeams(
  auth: BetterAuthInstance,
): Promise<{ orgsProcessed: number; teamsCreated: number }> {
  const adapter = (await auth.$context).adapter;
  const orgs = await adapter.findMany<OrganizationRow>({
    model: 'organization',
  });
  let teamsCreated = 0;
  for (const org of orgs) {
    const existingTeams = await adapter.findMany<TeamRow>({
      model: 'team',
      where: [{ field: 'organizationId', value: org.id }],
    });
    const hadTeam = existingTeams.length > 0;
    await ensureDefaultTeamForOrg(auth, org.id, org.name);
    if (!hadTeam) {
      teamsCreated++;
    }
  }
  return { orgsProcessed: orgs.length, teamsCreated };
}

export async function ensureLocalBetterAuthOrganization(
  _db: Db,
  auth: BetterAuthInstance,
): Promise<OrganizationSummary> {
  const existing = await getOrganizationById(auth, DEFAULT_ORG_ID);
  if (existing !== undefined) {
    await ensureDefaultTeamForOrg(auth, DEFAULT_ORG_ID, 'Personal');
    return existing;
  }

  const now = new Date();
  const adapter = (await auth.$context).adapter;
  const data = {
    id: DEFAULT_ORG_ID,
    name: 'Personal',
    slug: 'local',
    createdAt: now,
  };
  const created = await adapter.create<OrganizationRow>({
    model: 'organization',
    data,
    forceAllowId: true,
  });
  await ensureDefaultTeamForOrg(auth, DEFAULT_ORG_ID, 'Personal');
  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    createdAt: created.createdAt,
  };
}

export type ProvisionPersonalOrgResult =
  | { created: true; orgId: string; role: 'owner' }
  | { created: false; reason: 'not_github' | 'already_member' };

/**
 * BA4c: first better-auth GitHub session with zero memberships gets a personal
 * org + owner member. Invited users who already hold a member row are left alone.
 */
export async function provisionPersonalOrgIfNeeded(
  auth: BetterAuthInstance,
  _db: Db,
  userId: string,
): Promise<ProvisionPersonalOrgResult> {
  const adapter = (await auth.$context).adapter;

  const account = await adapter.findOne<AccountRow>({
    model: 'account',
    where: [
      { field: 'userId', value: userId },
      { field: 'providerId', value: GITHUB_PROVIDER_ID },
    ],
  });
  if (account === null) {
    return { created: false, reason: 'not_github' };
  }

  const members = await adapter.findMany<MemberRow>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
  });
  if (members.length > 0) {
    return { created: false, reason: 'already_member' };
  }

  const user = await adapter.findOne<UserRow>({
    model: 'user',
    where: [{ field: 'id', value: userId }],
  });
  if (user === null) {
    throw new Error('session user missing during personal org provision');
  }

  const orgName = user.name.trim().length > 0 ? user.name.trim() : 'Personal';
  const now = new Date();
  const organization = await adapter.create<OrganizationRow>({
    model: 'organization',
    data: {
      name: orgName,
      slug: `u-${userId}`,
      createdAt: now,
    },
  });
  await adapter.create<MemberRow>({
    model: 'member',
    data: {
      organizationId: organization.id,
      userId,
      role: 'owner',
      createdAt: now,
    },
  });
  await ensureDefaultTeamForOrg(auth, organization.id, organization.name);

  return { created: true, orgId: organization.id, role: 'owner' };
}

/** Persist the best active organization for a newly-created session. */
export async function setDefaultActiveOrganization(
  auth: BetterAuthInstance,
  userId: string,
  sessionToken: string,
): Promise<string | undefined> {
  const context = await auth.$context;
  const members = await context.adapter.findMany<MemberRow>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
    sortBy: { field: 'createdAt', direction: 'asc' },
  });
  if (members.length === 0) {
    return undefined;
  }

  const memberOrgIds = new Set(members.map((member) => member.organizationId));
  const sessions = await context.adapter.findMany<SessionRow>({
    model: 'session',
    where: [{ field: 'userId', value: userId }],
    sortBy: { field: 'updatedAt', direction: 'desc' },
  });
  const priorActiveOrganizationId = sessions.find(
    (session) =>
      session.token !== sessionToken &&
      session.activeOrganizationId !== undefined &&
      session.activeOrganizationId !== null &&
      memberOrgIds.has(session.activeOrganizationId),
  )?.activeOrganizationId;
  const activeOrganizationId = priorActiveOrganizationId ?? members[0]?.organizationId;
  if (activeOrganizationId === undefined) {
    return undefined;
  }

  await context.internalAdapter.updateSession(sessionToken, { activeOrganizationId });
  return activeOrganizationId;
}
