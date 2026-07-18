import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID, createDb, migrate, type Db } from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import { createOrgOwnerKey } from './agent-keys.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { ensureLocalBetterAuthOrganization } from './identity.js';
import { createApp } from './server.js';
import { parseJson } from './test-helpers.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';
const WS_HEADER = 'x-plandesk-workspace-id';

async function loopbackApp(): Promise<{ app: Hono; db: Db; auth: BetterAuthInstance }> {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({ client: db.$client, secret: TEST_SECRET, baseURL: TEST_BASE_URL });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);
  const app = createApp({ db, bindHost: '127.0.0.1', betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL } });
  await ensureLocalBetterAuthOrganization(db, auth);
  return { app, db, auth };
}

describe('workspace loopback scoping (x-plandesk-workspace-id header)', () => {
  it('loopback + header scopes list to the workspace and 404s outside it; no header = all', async () => {
    const { app, db } = await loopbackApp();
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projA = await createProject(db, { name: 'A', orgId: DEFAULT_ORG_ID, workspaceId: wsA });
    const projB = await createProject(db, { name: 'B', orgId: DEFAULT_ORG_ID, workspaceId: wsB });

    // With header W-A: list only A, GET B -> 404
    const listA = await app.request('/api/v1/projects', { headers: { [WS_HEADER]: wsA } });
    const listedA = await parseJson<Array<{ id: string }>>(listA);
    expect(listedA.some((p) => p.id === projA.id)).toBe(true);
    expect(listedA.some((p) => p.id === projB.id)).toBe(false);

    const getBscoped = await app.request(`/api/v1/projects/${projB.id}`, { headers: { [WS_HEADER]: wsA } });
    expect(getBscoped.status).toBe(404);

    const getAscoped = await app.request(`/api/v1/projects/${projA.id}`, { headers: { [WS_HEADER]: wsA } });
    expect(getAscoped.status).toBe(200);

    // No header: owner loopback sees both
    const listAll = await app.request('/api/v1/projects');
    const listedAll = await parseJson<Array<{ id: string }>>(listAll);
    expect(listedAll.some((p) => p.id === projA.id)).toBe(true);
    expect(listedAll.some((p) => p.id === projB.id)).toBe(true);
  });

  it('SECURITY: a token (apikey owner) request IGNORES the header — cannot be scoped or fooled by it', async () => {
    // hosted app (non-loopback): owner token sees all regardless of a spoofed header
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({ client: db.$client, secret: TEST_SECRET, baseURL: TEST_BASE_URL, github: { clientId: 'x', clientSecret: 'y' } })!;
    await runBetterAuthMigrations(auth);
    const app = createApp({ db, bindHost: '0.0.0.0', github: { clientId: 'x', clientSecret: 'y', callbackUrl: 'https://t/cb', dashboardUrl: '/' }, betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL } });

    const org = randomUUID();
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projA = await createProject(db, { name: 'A', orgId: org, workspaceId: wsA });
    const projB = await createProject(db, { name: 'B', orgId: org, workspaceId: wsB });
    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const user = await adapter.create<{ id: string }>({ model: 'user', data: { name: 'U', email: 'o@x.com', emailVerified: true, image: null, createdAt: now, updatedAt: now } });
    await adapter.create({ model: 'account', data: { accountId: '9200', providerId: 'github', userId: user.id, createdAt: now, updatedAt: now } });
    await adapter.create({ model: 'organization', data: { id: org, name: org, slug: 'o', createdAt: now }, forceAllowId: true });
    await adapter.create({ model: 'member', data: { organizationId: org, userId: user.id, role: 'owner', createdAt: now } });
    const ownerKey = await createOrgOwnerKey({ auth, userId: user.id, orgId: org, name: 'o' });

    // Owner token + spoofed workspace header → still sees BOTH projects (header ignored for token ctx)
    const list = await app.request('/api/v1/projects', { headers: { Authorization: `Bearer ${ownerKey.key}`, [WS_HEADER]: wsA } });
    const listed = await parseJson<Array<{ id: string }>>(list);
    expect(listed.some((p) => p.id === projA.id)).toBe(true);
    expect(listed.some((p) => p.id === projB.id)).toBe(true);

    const getB = await app.request(`/api/v1/projects/${projB.id}`, { headers: { Authorization: `Bearer ${ownerKey.key}`, [WS_HEADER]: wsA } });
    expect(getB.status).toBe(200);
  });
});
