import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  DEFAULT_ORG_ID,
  orgMembers,
  orgs,
  type OrgRole,
} from '../schema.js';

export type Org = typeof orgs.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;

export type NewOrg = {
  name: string;
  id?: string;
};

export type NewOrgMember = {
  orgId: string;
  userRef: string;
  role: OrgRole;
};

export async function createOrg(db: DbClient, input: NewOrg): Promise<Org> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(orgs)
    .values({
      id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create org');
  }
  return row;
}

export async function getOrg(db: DbClient, id: string): Promise<Org | undefined> {
  return db.select().from(orgs).where(eq(orgs.id, id)).get();
}

export async function listOrgs(db: DbClient): Promise<Org[]> {
  return db.select().from(orgs).all();
}

/**
 * Default org for loopback single-org auth and local bootstrap.
 * Prefer the well-known DEFAULT_ORG_ID; otherwise the sole org when count === 1.
 */
export async function getDefaultOrg(db: DbClient): Promise<Org | undefined> {
  const byId = await getOrg(db, DEFAULT_ORG_ID);
  if (byId) {
    return byId;
  }
  const all = await listOrgs(db);
  if (all.length === 1) {
    return all[0];
  }
  return undefined;
}

/** Create the well-known default org if missing. Idempotent. */
export async function ensureDefaultOrg(
  db: DbClient,
  name = 'Personal',
): Promise<Org> {
  const existing = await getDefaultOrg(db);
  if (existing) {
    return existing;
  }
  return createOrg(db, { id: DEFAULT_ORG_ID, name });
}

export async function addOrgMember(
  db: DbClient,
  input: NewOrgMember,
): Promise<OrgMember> {
  const now = new Date();
  const rows = await db
    .insert(orgMembers)
    .values({
      orgId: input.orgId,
      userRef: input.userRef,
      role: input.role,
      createdAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to add org member');
  }
  return row;
}

export async function listOrgMembers(
  db: DbClient,
  orgId: string,
): Promise<OrgMember[]> {
  return db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId)).all();
}

export async function getOrgMember(
  db: DbClient,
  orgId: string,
  userRef: string,
): Promise<OrgMember | undefined> {
  return db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userRef, userRef)))
    .get();
}

export async function isSingleOrg(db: DbClient): Promise<boolean> {
  const all = await listOrgs(db);
  return all.length === 1;
}
