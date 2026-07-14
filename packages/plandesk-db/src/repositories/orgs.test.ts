import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import {
  addOrgMember,
  createOrg,
  ensureDefaultOrg,
  getDefaultOrg,
  getOrg,
  getOrgMember,
  listOrgMembers,
  listOrgMembershipsForUser,
  listOrgs,
} from './orgs.js';

describe('orgs repository', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('migration seeds a default org', async () => {
    const org = await getDefaultOrg(db);
    expect(org).toBeDefined();
    expect(org?.name).toBe('Personal');
  });

  it('ensureDefaultOrg is idempotent', async () => {
    const a = await ensureDefaultOrg(db);
    const b = await ensureDefaultOrg(db);
    expect(a.id).toBe(b.id);
    expect(await listOrgs(db)).toHaveLength(1);
  });

  it('creates org and members', async () => {
    const org = await createOrg(db, { name: 'Acme' });
    expect(await getOrg(db, org.id)).toEqual(org);
    const member = await addOrgMember(db, {
      orgId: org.id,
      userRef: 'alice',
      role: 'owner',
    });
    expect(member.role).toBe('owner');
    expect(await getOrgMember(db, org.id, 'alice')).toEqual(member);
    expect(await listOrgMembers(db, org.id)).toHaveLength(1);
  });

  it('listOrgMembershipsForUser finds the org a user_ref already belongs to', async () => {
    const org = await createOrg(db, { name: 'Acme' });
    await addOrgMember(db, { orgId: org.id, userRef: 'github:42', role: 'owner' });
    await addOrgMember(db, { orgId: org.id, userRef: 'github:99', role: 'viewer' });

    const found = await listOrgMembershipsForUser(db, 'github:42');
    expect(found).toHaveLength(1);
    expect(found[0]?.orgId).toBe(org.id);
    expect(found[0]?.role).toBe('owner');

    expect(await listOrgMembershipsForUser(db, 'github:nobody')).toEqual([]);
  });

  it('listOrgMembershipsForUser returns the oldest membership first', async () => {
    const first = await createOrg(db, { name: 'First' });
    const second = await createOrg(db, { name: 'Second' });
    await addOrgMember(db, { orgId: first.id, userRef: 'github:42', role: 'owner' });
    await addOrgMember(db, { orgId: second.id, userRef: 'github:42', role: 'editor' });

    const found = await listOrgMembershipsForUser(db, 'github:42');
    expect(found.map((m) => m.orgId)).toEqual([first.id, second.id]);
  });
});
