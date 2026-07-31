import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createDb,
  migrate,
  type Db,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import { createScopedAgentKey } from './agent-keys.js';
import { tryGetAuthContext } from './auth-context.js';
import { createOrgAuthMiddleware } from './auth.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { resolveWriteActor } from './services/org-scope.js';
import { WriteActorUnresolvedError } from './write-actor.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';
const AGENT_RUN_HEADER = 'x-plandesk-agent-run-id';

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

async function seedBetterAuthUser(
  auth: BetterAuthInstance,
  opts: {
    email: string;
    name: string;
    githubAccountId: string;
    org: { id: string; name: string; slug: string };
    role: 'owner' | 'admin' | 'member';
  },
): Promise<{ userId: string }> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: opts.name,
      email: opts.email,
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

  const existingOrg = await adapter.findOne<BetterAuthOrganization>({
    model: 'organization',
    where: [{ field: 'id', value: opts.org.id }],
  });
  if (existingOrg === null) {
    const orgData = {
      id: opts.org.id,
      name: opts.org.name,
      slug: opts.org.slug,
      createdAt: now,
    };
    await adapter.create<BetterAuthOrganization>({
      model: 'organization',
      data: orgData,
      forceAllowId: true,
    });
  }

  await adapter.create<BetterAuthMember>({
    model: 'member',
    data: {
      organizationId: opts.org.id,
      userId: user.id,
      role: opts.role,
      createdAt: now,
    },
  });

  return { userId: user.id };
}

async function hostedFixture(): Promise<{
  db: Db;
  auth: BetterAuthInstance;
}> {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    github: { clientId: 'test-client', clientSecret: 'test-secret' },
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);
  return { db, auth };
}

function bearer(key: string): { Authorization: string } {
  return { Authorization: `Bearer ${key}` };
}

function createActorProbeApp(db: Db, auth: BetterAuthInstance): Hono {
  const app = new Hono();
  app.use(
    '*',
    createOrgAuthMiddleware({
      db,
      bindHost: '0.0.0.0',
      betterAuth: auth,
    }),
  );
  app.post('/probe', (c) => {
    const ctx = tryGetAuthContext();
    try {
      const actor = resolveWriteActor({});
      return c.json({
        ok: true,
        actor,
        agentRunId: ctx?.kind === 'apikey' ? ctx.agentRunId : undefined,
      });
    } catch (error) {
      if (error instanceof WriteActorUnresolvedError) {
        return c.json({
          ok: false,
          error: 'actor_unresolved',
          agentRunId: ctx?.kind === 'apikey' ? ctx.agentRunId : undefined,
        }, 403);
      }
      throw error;
    }
  });
  return app;
}

describe('x-plandesk-agent-run-id header (org-scoped attribution)', () => {
  it('rejects a running run id from another org — actor stays unresolved, not system', async () => {
    const { db, auth } = await hostedFixture();
    const orgA = { id: randomUUID(), name: 'Org A', slug: 'org-a' };
    const orgB = { id: randomUUID(), name: 'Org B', slug: 'org-b' };
    const projectA = await createProject(db, { name: 'Board A', orgId: orgA.id });
    const projectB = await createProject(db, { name: 'Board B', orgId: orgB.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'A',
      githubAccountId: '9001',
      org: orgA,
      role: 'owner',
    });
    const agentKey = await createScopedAgentKey({
      auth,
      userId,
      orgId: orgA.id,
      projectId: projectA.id,
      name: 'agent-a',
    });
    const foreignRun = await createAgentRun(db, {
      projectId: projectB.id,
      label: 'Foreign run',
      status: 'running',
    });

    const app = createActorProbeApp(db, auth);
    const res = await app.request('/probe', {
      method: 'POST',
      headers: {
        ...bearer(agentKey.key),
        [AGENT_RUN_HEADER]: foreignRun.id,
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'actor_unresolved',
      agentRunId: undefined,
    });
  });

  it('rejects a running run id from another project in the same org when the key is project-bound', async () => {
    const { db, auth } = await hostedFixture();
    const org = { id: randomUUID(), name: 'Shared Org', slug: 'shared-org' };
    const projectA = await createProject(db, { name: 'Board A', orgId: org.id });
    const projectB = await createProject(db, { name: 'Board B', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'same@example.com',
      name: 'Same',
      githubAccountId: '9002',
      org,
      role: 'owner',
    });
    const agentKey = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: projectA.id,
      name: 'agent-project-a',
    });
    const otherProjectRun = await createAgentRun(db, {
      projectId: projectB.id,
      label: 'Other project run',
      status: 'running',
    });

    const app = createActorProbeApp(db, auth);
    const res = await app.request('/probe', {
      method: 'POST',
      headers: {
        ...bearer(agentKey.key),
        [AGENT_RUN_HEADER]: otherProjectRun.id,
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'actor_unresolved',
      agentRunId: undefined,
    });
  });

  it('resolves same-org same-project running run to agent actor', async () => {
    const { db, auth } = await hostedFixture();
    const org = { id: randomUUID(), name: 'Happy Org', slug: 'happy-org' };
    const project = await createProject(db, { name: 'Happy Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'happy@example.com',
      name: 'Happy',
      githubAccountId: '9003',
      org,
      role: 'owner',
    });
    const agentKey = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      name: 'happy-agent',
    });
    const run = await createAgentRun(db, {
      projectId: project.id,
      label: 'Happy run',
      status: 'running',
    });

    const app = createActorProbeApp(db, auth);
    const res = await app.request('/probe', {
      method: 'POST',
      headers: {
        ...bearer(agentKey.key),
        [AGENT_RUN_HEADER]: run.id,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      actor: { kind: 'agent', runId: run.id },
      agentRunId: run.id,
    });
  });

  it('unknown and non-running run ids fail closed without attaching agentRunId', async () => {
    const { db, auth } = await hostedFixture();
    const org = { id: randomUUID(), name: 'Closed Org', slug: 'closed-org' };
    const project = await createProject(db, { name: 'Closed Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'closed@example.com',
      name: 'Closed',
      githubAccountId: '9004',
      org,
      role: 'owner',
    });
    const agentKey = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      name: 'closed-agent',
    });
    const completedRun = await createAgentRun(db, {
      projectId: project.id,
      label: 'Done run',
      status: 'completed',
    });

    const app = createActorProbeApp(db, auth);

    const unknownRes = await app.request('/probe', {
      method: 'POST',
      headers: {
        ...bearer(agentKey.key),
        [AGENT_RUN_HEADER]: '00000000-0000-4000-8000-000000009999',
      },
    });
    expect(unknownRes.status).toBe(403);
    expect(await unknownRes.json()).toEqual({
      ok: false,
      error: 'actor_unresolved',
      agentRunId: undefined,
    });

    const completedRes = await app.request('/probe', {
      method: 'POST',
      headers: {
        ...bearer(agentKey.key),
        [AGENT_RUN_HEADER]: completedRun.id,
      },
    });
    expect(completedRes.status).toBe(403);
    expect(await completedRes.json()).toEqual({
      ok: false,
      error: 'actor_unresolved',
      agentRunId: undefined,
    });
  });
});
