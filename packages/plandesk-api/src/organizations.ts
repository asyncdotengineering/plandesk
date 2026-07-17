import { DEFAULT_ORG_ID } from '@plandesk/db';
import type { BetterAuthInstance } from './better-auth.js';

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
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
