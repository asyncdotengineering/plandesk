import { ensureDefaultOrg, type Db, type Org } from '@plandesk/db';
import type { BetterAuthInstance } from './better-auth.js';
import type { GithubIdentity } from './github.js';

const GITHUB_PROVIDER_ID = 'github';
const GITHUB_USER_REF_PREFIX = 'github:';
const NUMERIC_GITHUB_ID = /^[1-9]\d*$/;

type AccountRow = {
  accountId: string;
  providerId: string;
  userId: string;
};

type UserRow = { id: string };

type MemberRow = {
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
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

export async function ensureLocalBetterAuthOrganization(
  db: Db,
  auth: BetterAuthInstance,
): Promise<Org> {
  const org = await ensureDefaultOrg(db);
  const adapter = (await auth.$context).adapter;
  const existing = await adapter.findOne<OrganizationRow>({
    model: 'organization',
    where: [{ field: 'id', value: org.id }],
  });
  if (existing !== null) return org;

  const data = {
    id: org.id,
    name: org.name,
    slug: 'local',
    createdAt: org.createdAt,
  };
  await adapter.create<OrganizationRow>({
    model: 'organization',
    data,
    forceAllowId: true,
  });
  return org;
}
