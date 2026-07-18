import { randomUUID, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORG_ID,
  createTaskWithDefaultGoal as createTask,
  createEdge,
  createDocument,
  createGoal,
  createFile,
  exportProject,
  getFile,
  getProject,
  importProject,
  migrate,
  createDb,
  PLANDESK_EXPORT_VERSION,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import {
  createBetterAuth,
  createOrgOwnerKey,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from '../index.js';
import { createApp } from '../server.js';
import { createTestApp, parseJson } from '../test-helpers.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

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

async function seedOwner(
  auth: BetterAuthInstance,
  org: { id: string; name: string; slug: string },
  email: string,
  githubAccountId: string,
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: email,
      email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthAccount>({
    model: 'account',
    data: {
      accountId: githubAccountId,
      providerId: 'github',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  const existingOrg = await adapter.findOne<BetterAuthOrganization>({
    model: 'organization',
    where: [{ field: 'id', value: org.id }],
  });
  if (existingOrg === null) {
    const orgData = {
      id: org.id,
      name: org.name,
      slug: org.slug,
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
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    },
  });
  return user.id;
}

describe('POST /api/v1/orgs/:id/import', () => {
  it('test:push_export_roundtrip — local export → hosted import → re-export deep-equal graph', async () => {
    // Single-org loopback owner (no mcp_token).
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const org = { id: DEFAULT_ORG_ID, name: 'Personal' };

    const local = await createProject(db, {
      name: 'Promote Me',
      description: 'one-way push fixture',
      orgId: org.id,
    });
    const goal = await createGoal(db, {
      projectId: local.id,
      objective: 'Ship promote',
      status: 'active',
    });
    const taskA = await createTask(db, {
      projectId: local.id,
      goalId: goal.id,
      label: 'Design',
      status: 'done',
      description: 'spec it',
      x: 10,
      y: 20,
    });
    const taskB = await createTask(db, {
      projectId: local.id,
      goalId: goal.id,
      label: 'Build',
      status: 'todo',
      x: 40,
      y: 20,
    });
    await createEdge(db, {
      projectId: local.id,
      fromTaskId: taskA.id,
      toTaskId: taskB.id,
      label: 'blocks',
    });
    await createDocument(db, {
      projectId: local.id,
      title: 'Scope',
      body: '## Why\nPromote is one-way sync.',
      linkedTaskId: taskA.id,
    });

    const localExport = await exportProject(db, local.id);
    expect(localExport).toBeDefined();
    if (!localExport) {
      return;
    }

    const res = await app.request(`/api/v1/orgs/${org.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localExport),
    });
    expect(res.status).toBe(201);
    const body = await parseJson<{ globalProjectId: string }>(res);
    expect(typeof body.globalProjectId).toBe('string');
    expect(body.globalProjectId).not.toBe(local.id);

    const hosted = await getProject(db, body.globalProjectId);
    expect(hosted?.orgId).toBe(org.id);
    expect(hosted?.name).toBe('Promote Me');

    const hostedExport = await exportProject(db, body.globalProjectId);
    expect(hostedExport).toBeDefined();
    if (!hostedExport) {
      return;
    }

    expect(hostedExport.version).toBe(PLANDESK_EXPORT_VERSION);
    expect(hostedExport.project).toEqual(localExport.project);
    expect(hostedExport.goals).toHaveLength(localExport.goals.length);
    expect(hostedExport.tasks).toHaveLength(localExport.tasks.length);
    expect(hostedExport.edges).toHaveLength(localExport.edges.length);
    expect(hostedExport.documents).toHaveLength(localExport.documents.length);

    const goalObjectives = (g: typeof localExport.goals) =>
      g.map((x) => x.objective).sort();
    expect(goalObjectives(hostedExport.goals)).toEqual(goalObjectives(localExport.goals));

    const taskLabels = (t: typeof localExport.tasks) =>
      t
        .map((x) => ({ label: x.label, status: x.status, description: x.description }))
        .sort((a, b) => a.label.localeCompare(b.label));
    expect(taskLabels(hostedExport.tasks)).toEqual(taskLabels(localExport.tasks));

    const edgeLabels = (e: typeof localExport.edges) =>
      e.map((x) => x.label).sort();
    expect(edgeLabels(hostedExport.edges)).toEqual(edgeLabels(localExport.edges));

    const docTitles = (d: typeof localExport.documents) =>
      d.map((x) => ({ title: x.title, body: x.body })).sort((a, b) => a.title.localeCompare(b.title));
    expect(docTitles(hostedExport.documents)).toEqual(docTitles(localExport.documents));

    const columns = await db.$client.execute('PRAGMA table_info(projects)');
    const names = columns.rows.map((row) => String(row['name'] ?? row[1])).sort();
    expect(names).toEqual([
      'canvas_layout',
      'created_at',
      'description',
      'id',
      'name',
      'org_id',
      'updated_at',
      'workspace_id',
    ]);
  });

  it('rejects import into org-B with an org-A key', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };

    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const userA = await seedOwner(
      auth,
      { id: orgA.id, name: orgA.name, slug: 'org-a' },
      'a@import.test',
      '7101',
    );
    const keyA = await createOrgOwnerKey({
      auth,
      userId: userA,
      orgId: orgA.id,
      name: 'a-key',
    });

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

    const local = await createProject(db, { name: 'Only A', orgId: orgA.id });
    const exported = await exportProject(db, local.id);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }

    const res = await app.request(`/api/v1/orgs/${orgB.id}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keyA.key}`,
      },
      body: JSON.stringify(exported),
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('importing the same file bytes into two different orgs does not collide', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };

    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const userA = await seedOwner(
      auth,
      { id: orgA.id, name: orgA.name, slug: 'org-a' },
      'a2@import.test',
      '7102',
    );
    const userB = await seedOwner(
      auth,
      { id: orgB.id, name: orgB.name, slug: 'org-b' },
      'b2@import.test',
      '7103',
    );
    const keyA = await createOrgOwnerKey({
      auth,
      userId: userA,
      orgId: orgA.id,
      name: 'a-key',
    });
    const keyB = await createOrgOwnerKey({
      auth,
      userId: userB,
      orgId: orgB.id,
      name: 'b-key',
    });

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

    const bytes = Buffer.from('identical-bytes-for-two-orgs', 'utf8');
    const fileId = createHash('sha256').update(bytes).digest('hex');

    const seed = await createProject(db, { name: 'With File', orgId: orgA.id });
    await createFile(db, {
      id: fileId,
      projectId: seed.id,
      filename: 'shot.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    const exported = await exportProject(db, seed.id);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(exported.files).toHaveLength(1);
    expect(exported.files[0]?.id).toBe(fileId);

    const resA = await app.request(`/api/v1/orgs/${orgA.id}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keyA.key}`,
      },
      body: JSON.stringify(exported),
    });
    expect(resA.status).toBe(201);
    const { globalProjectId: projectA } = await parseJson<{ globalProjectId: string }>(resA);

    const resB = await app.request(`/api/v1/orgs/${orgB.id}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keyB.key}`,
      },
      body: JSON.stringify(exported),
    });
    expect(resB.status).toBe(201);
    const { globalProjectId: projectB } = await parseJson<{ globalProjectId: string }>(resB);

    expect(projectA).not.toBe(projectB);
    const fileA = await getFile(db, projectA, fileId);
    const fileB = await getFile(db, projectB, fileId);
    expect(fileA?.bytes).toEqual(bytes);
    expect(fileB?.bytes).toEqual(bytes);
    expect(fileA?.projectId).toBe(projectA);
    expect(fileB?.projectId).toBe(projectB);
  });

  it('projects table columns stay the base schema (no promotion mode flags)', async () => {
    const { db } = await createTestApp();
    const columns = await db.$client.execute('PRAGMA table_info(projects)');
    const names = columns.rows.map((row) => String(row['name'] ?? row[1])).sort();
    expect(names).toEqual([
      'canvas_layout',
      'created_at',
      'description',
      'id',
      'name',
      'org_id',
      'updated_at',
      'workspace_id',
    ]);
  });
});

describe('importProject orgId option', () => {
  it('places the project in the given org', async () => {
    const { db } = await createTestApp();
    const orgB = { id: randomUUID(), name: 'Target' };
    const blob = {
      version: PLANDESK_EXPORT_VERSION,
      project: { name: 'Direct', description: null, canvas_layout: null },
      goals: [],
      tasks: [],
      tags: [],
      edges: [],
      folders: [],
      documents: [],
      notes: [],
      comments: [],
      agent_runs: [],
      files: [],
      artifacts: [],
    };
    const { projectId } = await importProject(db, blob, { orgId: orgB.id });
    const project = await getProject(db, projectId);
    expect(project?.orgId).toBe(orgB.id);
  });
});
