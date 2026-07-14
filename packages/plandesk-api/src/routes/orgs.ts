import { Hono } from 'hono';
import {
  addOrgMember,
  createOrg,
  createToken,
  getOrg,
  getOrgMember,
  listOrgMembers,
  orgRoles,
  tokenScopes,
  type Db,
  type OrgRole,
  type TokenScope,
} from '@plandesk/db';
import { getAuthContext } from '../auth-context.js';

function isOrgRole(value: string): value is OrgRole {
  return (orgRoles as readonly string[]).includes(value);
}

function isTokenScope(value: string): value is TokenScope {
  return (tokenScopes as readonly string[]).includes(value);
}

export function createOrgsRouter(db: Db): Hono {
  const router = new Hono();

  // Create org + owner token (raw token returned once).
  router.post('/orgs', async (c) => {
    const body = await c.req.json<{ name?: string; owner_ref?: string }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const ownerRef =
      typeof body.owner_ref === 'string' && body.owner_ref.trim() !== ''
        ? body.owner_ref.trim()
        : 'owner';

    const org = await createOrg(db, { name: body.name.trim() });
    await addOrgMember(db, { orgId: org.id, userRef: ownerRef, role: 'owner' });
    const token = await createToken(db, {
      name: `${org.name} owner`,
      orgId: org.id,
      scope: 'full',
    });

    return c.json(
      {
        id: org.id,
        name: org.name,
        created_at: org.createdAt.toISOString(),
        owner_token: {
          id: token.id,
          name: token.name,
          token: token.token,
          scope: token.scope,
        },
      },
      201,
    );
  });

  router.post('/orgs/:id/tokens', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }

    // Caller must already be authenticated as this org (token or sole default).
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }

    const body = await c.req.json<{ name?: string; scope?: string }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    let scope: TokenScope = 'full';
    if (body.scope !== undefined) {
      if (!isTokenScope(body.scope)) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      scope = body.scope;
    }

    const created = await createToken(db, {
      name: body.name.trim(),
      orgId,
      scope,
    });

    return c.json(
      {
        id: created.id,
        name: created.name,
        token: created.token,
        scope: created.scope,
      },
      201,
    );
  });

  router.post('/orgs/:id/members', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }

    const body = await c.req.json<{ user_ref?: string; role?: string }>();
    if (typeof body.user_ref !== 'string' || body.user_ref.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.role !== 'string' || !isOrgRole(body.role)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const existing = await getOrgMember(db, orgId, body.user_ref.trim());
    if (existing) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const member = await addOrgMember(db, {
      orgId,
      userRef: body.user_ref.trim(),
      role: body.role,
    });

    return c.json(
      {
        org_id: member.orgId,
        user_ref: member.userRef,
        role: member.role,
        created_at: member.createdAt.toISOString(),
      },
      201,
    );
  });

  router.get('/orgs/:id/members', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }

    const members = await listOrgMembers(db, orgId);
    return c.json(
      members.map((m) => ({
        org_id: m.orgId,
        user_ref: m.userRef,
        role: m.role,
        created_at: m.createdAt.toISOString(),
      })),
    );
  });

  return router;
}
