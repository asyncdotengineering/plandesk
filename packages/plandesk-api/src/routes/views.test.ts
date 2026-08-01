import { describe, expect, it } from 'vitest';
import {
  createProjectInDefaultOrg as createProject,
  listViews,
  NON_TRIVIAL_SAVED_VIEW_CONFIG,
  type SavedViewConfig,
} from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type ViewResponse = {
  id: string;
  project_id: string;
  name: string;
  config: SavedViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('views routes', () => {
  it('round-trips nested filter, two-level sort, two-level group, and columns in a new session', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Views' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/views`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Blocked & urgent',
        config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
        position: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<ViewResponse>(createRes);
    expect(created.config).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);
    expect(created.config.filter).toMatchObject({
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'condition', field: 'status', operator: 'is', value: 'blocked' },
        {
          kind: 'group',
          op: 'or',
          children: [
            { kind: 'condition', field: 'priority', operator: 'is', value: 'urgent' },
            { kind: 'condition', field: 'tags', operator: 'contains', value: 'p0' },
          ],
        },
      ],
    });
    expect(created.config.sort).toEqual([
      { field: 'priority', direction: 'desc' },
      { field: 'due_date', direction: 'asc' },
    ]);
    expect(created.config.group).toEqual([
      { field: 'goal_id', direction: 'asc' },
      { field: 'status', direction: 'asc' },
    ]);
    expect(created.config.visibleColumns).toEqual([
      'label',
      'status',
      'priority',
      'assignee',
      'due_date',
    ]);

    // Fresh request (not the create response) proves the composed config was stored.
    const getRes = await app.request(`/api/v1/views/${created.id}`);
    expect(getRes.status).toBe(200);
    const reloaded = await parseJson<ViewResponse>(getRes);
    expect(reloaded.config).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);
    expect(reloaded.name).toBe('Blocked & urgent');

    const listRes = await app.request(`/api/v1/projects/${project.id}/views`);
    expect(listRes.status).toBe(200);
    const listed = await parseJson<ViewResponse[]>(listRes);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.config).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);
  });

  it('rejects a config that does not match the schema on write (not stored)', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Reject' });

    const bad = await app.request(`/api/v1/projects/${project.id}/views`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Bad',
        config: {
          version: 1,
          filter: { kind: 'condition', field: 'status', operator: 'contains', value: 'x' },
          sort: [],
          group: null,
          visibleColumns: [],
        },
      }),
    });
    expect(bad.status).toBe(400);
    expect(await listViews(db, project.id)).toHaveLength(0);

    const missingVersion = await app.request(`/api/v1/projects/${project.id}/views`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'No version',
        config: { filter: null, sort: [], group: null, visibleColumns: [] },
      }),
    });
    expect(missingVersion.status).toBe(400);
    expect(await listViews(db, project.id)).toHaveLength(0);
  });

  it('keeps a second view independent; rename and delete leave others untouched', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Independent' });

    const firstRes = await app.request(`/api/v1/projects/${project.id}/views`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'First',
        config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
      }),
    });
    const first = await parseJson<ViewResponse>(firstRes);

    const secondRes = await app.request(`/api/v1/projects/${project.id}/views`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Second',
        config: {
          version: 1,
          filter: null,
          sort: [{ field: 'label', direction: 'asc' }],
          group: null,
          visibleColumns: ['label'],
        },
      }),
    });
    const second = await parseJson<ViewResponse>(secondRes);
    expect(second.config).not.toEqual(first.config);

    const rename = await app.request(`/api/v1/views/${first.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'First renamed' }),
    });
    expect(rename.status).toBe(200);
    expect((await parseJson<ViewResponse>(rename)).name).toBe('First renamed');

    const stillSecond = await parseJson<ViewResponse>(
      await app.request(`/api/v1/views/${second.id}`),
    );
    expect(stillSecond.name).toBe('Second');

    const del = await app.request(`/api/v1/views/${first.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const list = await parseJson<ViewResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/views`),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(second.id);
    expect(list[0]?.config).toEqual({
      version: 1,
      filter: null,
      sort: [{ field: 'label', direction: 'asc' }],
      group: null,
      visibleColumns: ['label'],
    });
  });

  it('denies cross-org HTTP read and write of a view', async () => {
    const { randomUUID } = await import('node:crypto');
    const {
      createDb,
      migrate,
      createProject,
    } = await import('@plandesk/db');
    const {
      createBetterAuth,
      createOrgOwnerKey,
      runBetterAuthMigrations,
    } = await import('../index.js');
    const { createApp } = await import('../server.js');

    const db = await createDb(':memory:');
    await migrate(db);
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const projectA = await createProject(db, {
      name: 'A',
      orgId: orgA.id,
      workspaceId: wsA,
    });

    const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
    const TEST_BASE_URL = 'http://localhost:3000';
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const userB = await adapter.create<{ id: string }>({
      model: 'user',
      data: {
        name: 'Owner B',
        email: 'b-views@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create({
      model: 'account',
      data: {
        accountId: '9101',
        providerId: 'github',
        userId: userB.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create({
      model: 'organization',
      data: { id: orgB.id, name: orgB.name, slug: 'org-b-views', createdAt: now },
      forceAllowId: true,
    });
    await adapter.create({
      model: 'member',
      data: {
        organizationId: orgB.id,
        userId: userB.id,
        role: 'owner',
        createdAt: now,
      },
    });
    const keyB = await createOrgOwnerKey({
      auth,
      userId: userB.id,
      orgId: orgB.id,
      name: 'b-views-key',
    });

    const { createViewService } = await import('../services/views.js');
    const viewServiceA = createViewService({ db, orgId: orgA.id });
    const view = await viewServiceA.create(projectA.id, {
      name: 'Secret view',
      config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
    });
    if (view === undefined) {
      throw new Error('expected view create');
    }

    const app = createApp({
      db,
      bindHost: '0.0.0.0',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
      github: {
        clientId: 'c',
        clientSecret: 's',
        callbackUrl: 'https://x.test/cb',
      },
    });
    const bearer = { Authorization: `Bearer ${keyB.key}` };

    expect(
      (await app.request(`/api/v1/projects/${projectA.id}/views`, { headers: bearer })).status,
    ).toBe(404);
    expect((await app.request(`/api/v1/views/${view.id}`, { headers: bearer })).status).toBe(404);
    expect(
      (
        await app.request(`/api/v1/projects/${projectA.id}/views`, {
          method: 'POST',
          headers: { ...bearer, ...JSON_HEADERS },
          body: JSON.stringify({
            name: 'Leak',
            config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
          }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/views/${view.id}`, {
          method: 'PATCH',
          headers: { ...bearer, ...JSON_HEADERS },
          body: JSON.stringify({ name: 'Hijacked' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/views/${view.id}`, {
          method: 'DELETE',
          headers: bearer,
        })
      ).status,
    ).toBe(404);
  });

  it('deleting a project removes its views', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Cascade views' });
    await app.request(`/api/v1/projects/${project.id}/views`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Doomed',
        config: NON_TRIVIAL_SAVED_VIEW_CONFIG,
      }),
    });
    expect(await listViews(db, project.id)).toHaveLength(1);

    const del = await app.request(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(await listViews(db, project.id)).toHaveLength(0);
  });
});
