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
});
