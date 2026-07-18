import { DEFAULT_ORG_ID } from '@plandesk/db';
import type { BetterAuthInstance } from './better-auth.js';

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
};

type MemberRow = {
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

export type UserOrganizationSummary = {
  id: string;
  name: string;
  role: string;
};

/**
 * Look up a better-auth organization by id (user-less / server path).
 * Prefer this over auth.api.getFullOrganization when no session headers exist.
 */
export async function getOrganizationById(
  auth: BetterAuthInstance,
  organizationId: string,
): Promise<OrganizationSummary | undefined> {
  const adapter = (await auth.$context).adapter;
  const org = await adapter.findOne<OrganizationSummary>({
    model: 'organization',
    where: [{ field: 'id', value: organizationId }],
  });
  return org ?? undefined;
}

/**
 * Loopback default org: DEFAULT_ORG_ID if present, else the sole organization.
 */
export async function resolveDefaultOrganization(
  auth: BetterAuthInstance,
): Promise<OrganizationSummary | undefined> {
  const byId = await getOrganizationById(auth, DEFAULT_ORG_ID);
  if (byId !== undefined) {
    return byId;
  }
  const adapter = (await auth.$context).adapter;
  const all = await adapter.findMany<OrganizationSummary>({
    model: 'organization',
  });
  if (all.length === 1) {
    return all[0];
  }
  return undefined;
}

export async function listOrganizationsForUser(
  auth: BetterAuthInstance,
  userId: string,
): Promise<UserOrganizationSummary[]> {
  const adapter = (await auth.$context).adapter;
  const members = await adapter.findMany<MemberRow>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
    sortBy: { field: 'createdAt', direction: 'asc' },
  });
  return Promise.all(
    members.map(async (member) => {
      const organization = await getOrganizationById(auth, member.organizationId);
      if (organization === undefined) {
        throw new Error('Membership points to a missing organization');
      }
      return { id: organization.id, name: organization.name, role: member.role };
    }),
  );
}

type MemberWithId = MemberRow & { id: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
};

export type OrganizationMemberSummary = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
};

/** List better-auth members of an organization (email/name joined from user). */
export async function listOrganizationMembers(
  auth: BetterAuthInstance,
  organizationId: string,
): Promise<OrganizationMemberSummary[]> {
  const adapter = (await auth.$context).adapter;
  const members = await adapter.findMany<MemberWithId>({
    model: 'member',
    where: [{ field: 'organizationId', value: organizationId }],
    sortBy: { field: 'createdAt', direction: 'asc' },
  });
  return Promise.all(
    members.map(async (member) => {
      const user = await adapter.findOne<UserRow>({
        model: 'user',
        where: [{ field: 'id', value: member.userId }],
      });
      return {
        id: member.id,
        userId: member.userId,
        email: user?.email ?? '',
        name: user?.name ?? '',
        role: member.role,
        createdAt:
          member.createdAt instanceof Date
            ? member.createdAt.toISOString()
            : String(member.createdAt),
      };
    }),
  );
}

/**
 * Display-friendly org for /auth/session and similar.
 * Falls back to DEFAULT_ORG_ID → "Personal" when better-auth is not configured
 * (loopback offline).
 */
export async function resolveOrganizationName(
  auth: BetterAuthInstance | undefined,
  orgId: string,
): Promise<{ id: string; name: string }> {
  if (auth !== undefined) {
    const org = await getOrganizationById(auth, orgId);
    if (org !== undefined) {
      return { id: org.id, name: org.name };
    }
  }
  if (orgId === DEFAULT_ORG_ID) {
    return { id: DEFAULT_ORG_ID, name: 'Personal' };
  }
  return { id: orgId, name: orgId };
}
