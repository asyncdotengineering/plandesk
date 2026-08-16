import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createProject,
  createProjectInDefaultOrg,
  insertRevision,
  migrate,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createOrgOwnerKey, createScopedAgentKey } from '../agent-keys.js';
import { createBetterAuth, runBetterAuthMigrations } from '../index.js';
import { ensureHtmlBody } from '../markdown.js';
import { createApp } from '../server.js';
import { createDocumentService } from '../services/documents.js';
import { createTaskService } from '../services/tasks.js';
import { createTestApp, parseJson } from '../test-helpers.js';

type RevisionMeta = {
  id: string;
  author: string;
  changed_fields: string[];
  created_at: string;
  snapshot?: unknown;
  target_type?: string;
  target_id?: string;
};

type RevisionDetail = RevisionMeta & {
  target_type: string;
  target_id: string;
  snapshot: Record<string, unknown>;
};

type FieldDiff = {
  field: string;
  hunks: Array<{
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    lines: string[];
  }>;
};

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

async function seedCrossOrgFixture() {
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
  const taskA = await createTask(db, {
    projectId: projectA.id,
    label: 'Secret',
    description: 'v0',
  });
  const revision = await insertRevision(db, {
    projectId: projectA.id,
    targetType: 'task',
    targetId: taskA.id,
    snapshot: JSON.stringify({ label: 'Secret', description: 'v0' }),
    changedFields: JSON.stringify(['description']),
    author: 'human:user-a',
  });

  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    github: { clientId: 'c', clientSecret: 's' },
  });
  if (auth === undefined) {
    throw new Error('expected better-auth');
  }
  await runBetterAuthMigrations(auth);

  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const userB = await adapter.create<{ id: string }>({
    model: 'user',
    data: {
      name: 'Owner B',
      email: `b-revisions-${randomUUID()}@example.com`,
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
    data: {
      id: orgB.id,
      name: orgB.name,
      slug: `org-b-${randomUUID().slice(0, 8)}`,
      createdAt: now,
    },
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
    name: 'b-revisions-key',
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

  return {
    app,
    bearer: { Authorization: `Bearer ${keyB.key}` },
    projectA,
    taskA,
    revision,
  };
}

describe('revisions routes', () => {
  it('lists two task revisions newest-first with authors and changed fields and no snapshots', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'History' });
    const alice = createTaskService({
      db,
      orgId: project.orgId,
      actor: { kind: 'human', userId: 'alice' },
    });
    const bob = createTaskService({
      db,
      orgId: project.orgId,
      actor: { kind: 'human', userId: 'bob' },
    });
    const task = await createTask(db, { projectId: project.id, label: 'Card', description: 'v0' });

    await alice.update(task.id, { description: 'v1' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await bob.update(task.id, { description: 'v2' });

    const listRes = await app.request(
      `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
    );
    expect(listRes.status).toBe(200);
    const listed = await parseJson<RevisionMeta[]>(listRes);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.author).toBe('human:bob');
    expect(listed[1]?.author).toBe('human:alice');
    expect(new Date(listed[0]?.created_at ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(listed[1]?.created_at ?? 0).getTime(),
    );
    for (const row of listed) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.author).toBe('string');
      expect(row.changed_fields).toEqual(['description']);
      expect(typeof row.created_at).toBe('string');
      expect(row).not.toHaveProperty('snapshot');
      expect(row).not.toHaveProperty('target_type');
      expect(row).not.toHaveProperty('target_id');
    }
  });

  it('fetches one revision with its full snapshot', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Fetch' });
    const taskService = createTaskService({ db, orgId: project.orgId });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Card',
      description: 'prior',
    });
    await taskService.update(task.id, { description: 'next' });

    const listed = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    expect(listed).toHaveLength(1);
    const revisionId = listed[0]?.id;
    expect(revisionId).toBeDefined();
    if (revisionId === undefined) {
      return;
    }
    const getRes = await app.request(`/api/v1/revisions/${revisionId}`);
    expect(getRes.status).toBe(200);
    const detail = await parseJson<RevisionDetail>(getRes);
    expect(detail).toMatchObject({
      id: revisionId,
      target_type: 'task',
      target_id: task.id,
      changed_fields: ['description'],
      snapshot: { label: 'Card', description: 'prior' },
    });
  });

  it('REVERT-PROOF: one-word document body change yields a one-line Markdown diff, not a whole-block HTML replacement', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Projection' });
    const document = await createDocument(db, { projectId: project.id, title: 'Spec' });

    const older = await insertRevision(db, {
      projectId: project.id,
      targetType: 'document',
      targetId: document.id,
      snapshot: JSON.stringify({
        title: 'Spec',
        body: '<p>The quick brown fox jumps over the lazy dog.</p>',
        statusLine: null,
      }),
      changedFields: JSON.stringify(['body']),
      author: 'human:editor',
      createdAt: new Date(1_700_000_000_000),
    });
    const newer = await insertRevision(db, {
      projectId: project.id,
      targetType: 'document',
      targetId: document.id,
      snapshot: JSON.stringify({
        title: 'Spec',
        body: '<p>The quick red fox jumps over the lazy dog.</p>',
        statusLine: null,
      }),
      changedFields: JSON.stringify(['body']),
      author: 'human:editor',
      createdAt: new Date(1_700_000_001_000),
    });

    const diffRes = await app.request(`/api/v1/revisions/${older.id}/diff?against=${newer.id}`);
    expect(diffRes.status).toBe(200);
    const diffs = await parseJson<FieldDiff[]>(diffRes);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.field).toBe('body');
    expect(diffs[0]?.hunks).toHaveLength(1);
    const lines = diffs[0]?.hunks[0]?.lines ?? [];
    const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---'));
    const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    expect(removed).toEqual(['-The quick brown fox jumps over the lazy dog.']);
    expect(added).toEqual(['+The quick red fox jumps over the lazy dog.']);
    expect(lines.every((line) => !line.includes('<p>') && !line.includes('</p>'))).toBe(true);
  });

  it('diffs a task description directly with no Markdown projection step', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Plain' });
    const task = await createTask(db, { projectId: project.id, label: 'T', description: 'alpha' });
    const older = await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: task.id,
      snapshot: JSON.stringify({ label: 'T', description: 'alpha' }),
      changedFields: JSON.stringify(['description']),
      author: 'system',
      createdAt: new Date(1_700_000_000_000),
    });
    const newer = await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: task.id,
      snapshot: JSON.stringify({ label: 'T', description: 'beta' }),
      changedFields: JSON.stringify(['description']),
      author: 'system',
      createdAt: new Date(1_700_000_001_000),
    });

    const diffs = await parseJson<FieldDiff[]>(
      await app.request(`/api/v1/revisions/${older.id}/diff?against=${newer.id}`),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.field).toBe('description');
    const lines = diffs[0]?.hunks[0]?.lines ?? [];
    expect(lines).toContain('-alpha');
    expect(lines).toContain('+beta');
  });

  it('diffing against current compares the newest revision snapshot to the live row', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Current' });
    const taskService = createTaskService({ db, orgId: project.orgId });
    const task = await createTask(db, { projectId: project.id, label: 'Live', description: 'v0' });
    await taskService.update(task.id, { description: 'v1' });

    const listed = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    expect(listed).toHaveLength(1);
    const revisionId = listed[0]?.id;
    expect(revisionId).toBeDefined();
    if (revisionId === undefined) {
      return;
    }

    const diffs = await parseJson<FieldDiff[]>(
      await app.request(`/api/v1/revisions/${revisionId}/diff?against=current`),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.field).toBe('description');
    const lines = diffs[0]?.hunks[0]?.lines ?? [];
    expect(lines).toContain('-v0');
    expect(lines).toContain('+v1');
  });

  it('REVERT-PROOF: denies cross-org list of revisions', async () => {
    const f = await seedCrossOrgFixture();
    const res = await f.app.request(
      `/api/v1/projects/${f.projectA.id}/revisions?target_type=task&target_id=${f.taskA.id}`,
      { headers: f.bearer },
    );
    expect(res.status).toBe(404);
  });

  it('REVERT-PROOF: denies cross-org get of a revision', async () => {
    const f = await seedCrossOrgFixture();
    const res = await f.app.request(`/api/v1/revisions/${f.revision.id}`, { headers: f.bearer });
    expect(res.status).toBe(404);
  });

  it('REVERT-PROOF: denies cross-org diff of a revision', async () => {
    const f = await seedCrossOrgFixture();
    const res = await f.app.request(`/api/v1/revisions/${f.revision.id}/diff?against=current`, {
      headers: f.bearer,
    });
    expect(res.status).toBe(404);
  });

  it('rejects missing query params and unknown target_type', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Validate' });
    expect(
      (await app.request(`/api/v1/projects/${project.id}/revisions?target_type=task`)).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/v1/projects/${project.id}/revisions?target_type=note&target_id=${randomUUID()}`,
        )
      ).status,
    ).toBe(400);
    expect((await app.request(`/api/v1/revisions/${randomUUID()}/diff`)).status).toBe(400);
  });

  it('document status_line appears snake_cased on the wire', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Snake' });
    const docService = createDocumentService({ db, orgId: project.orgId });
    const document = await createDocument(db, {
      projectId: project.id,
      title: 'Doc',
      body: ensureHtmlBody('body'),
      statusLine: 'draft',
    });
    await docService.update(document.id, { statusLine: 'review' });

    const listed = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=document&target_id=${document.id}`,
      ),
    );
    expect(listed[0]?.changed_fields).toEqual(['status_line']);
    const revisionId = listed[0]?.id;
    expect(revisionId).toBeDefined();
    if (revisionId === undefined) {
      return;
    }
    const detail = await parseJson<RevisionDetail>(
      await app.request(`/api/v1/revisions/${revisionId}`),
    );
    expect(detail.snapshot).toMatchObject({
      title: 'Doc',
      status_line: 'draft',
    });
  });

  it('restoring an older revision makes the live row match its versioned fields', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Restore match' });
    const taskService = createTaskService({ db, orgId: project.orgId });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Original',
      description: 'v0 body',
    });
    await taskService.update(task.id, { label: 'Changed', description: 'v1 body' });

    const listed = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    expect(listed).toHaveLength(1);
    const revisionId = listed[0]?.id;
    expect(revisionId).toBeDefined();
    if (revisionId === undefined) {
      return;
    }

    const restoreRes = await app.request(`/api/v1/revisions/${revisionId}/restore`, {
      method: 'POST',
    });
    expect(restoreRes.status).toBe(200);
    const restored = await parseJson<{
      id: string;
      label: string;
      description: string | null;
    }>(restoreRes);
    expect(restored).toMatchObject({
      id: task.id,
      label: 'Original',
      description: 'v0 body',
    });
  });

  it('REVERT-PROOF: restoring produces a new revision; restoring twice returns to the first state with three revisions', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Append-only' });
    const taskService = createTaskService({ db, orgId: project.orgId });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Card',
      description: 'v0',
    });
    await taskService.update(task.id, { description: 'v1' });

    const afterEdit = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    expect(afterEdit).toHaveLength(1);
    const priorRevisionId = afterEdit[0]?.id;
    expect(priorRevisionId).toBeDefined();
    if (priorRevisionId === undefined) {
      return;
    }

    const firstRestore = await app.request(`/api/v1/revisions/${priorRevisionId}/restore`, {
      method: 'POST',
    });
    expect(firstRestore.status).toBe(200);
    expect(await parseJson<{ description: string | null }>(firstRestore)).toMatchObject({
      description: 'v0',
    });

    const afterFirst = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    expect(afterFirst).toHaveLength(2);

    // Newest revision holds the state just replaced (v1). Restore it to undo the undo.
    const redoRevisionId = afterFirst[0]?.id;
    expect(redoRevisionId).toBeDefined();
    if (redoRevisionId === undefined) {
      return;
    }
    const secondRestore = await app.request(`/api/v1/revisions/${redoRevisionId}/restore`, {
      method: 'POST',
    });
    expect(secondRestore.status).toBe(200);
    expect(await parseJson<{ description: string | null }>(secondRestore)).toMatchObject({
      description: 'v1',
    });

    const afterSecond = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    expect(afterSecond).toHaveLength(3);
  });

  it('REVERT-PROOF: restore leaves status, assignee and position untouched', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Not revert' });
    const taskService = createTaskService({ db, orgId: project.orgId });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Parked',
      description: 'old copy',
      status: 'todo',
      assignee: 'ada@example.com',
      x: 10,
      y: 20,
    });
    await taskService.update(task.id, {
      description: 'new copy',
      status: 'in_progress',
      x: 100,
      y: 200,
    });

    const listed = await parseJson<RevisionMeta[]>(
      await app.request(
        `/api/v1/projects/${project.id}/revisions?target_type=task&target_id=${task.id}`,
      ),
    );
    const revisionId = listed[0]?.id;
    expect(revisionId).toBeDefined();
    if (revisionId === undefined) {
      return;
    }

    const restored = await parseJson<{
      description: string | null;
      status: string;
      assignee: string | null;
      x: number;
      y: number;
    }>(await app.request(`/api/v1/revisions/${revisionId}/restore`, { method: 'POST' }));

    expect(restored.description).toBe('old copy');
    expect(restored.status).toBe('in_progress');
    expect(restored.assignee).toBe('ada@example.com');
    expect(restored.x).toBe(100);
    expect(restored.y).toBe(200);
  });

  it('restoring a revision whose target was deleted returns not-found', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectInDefaultOrg(db, { name: 'Gone' });
    const orphanId = randomUUID();
    const revision = await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: orphanId,
      snapshot: JSON.stringify({ label: 'Ghost', description: 'should not resurrect' }),
      changedFields: JSON.stringify(['description']),
      author: 'human:tester',
    });

    const res = await app.request(`/api/v1/revisions/${revision.id}/restore`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });

    const check = await app.request(`/api/v1/tasks/${orphanId}`);
    expect(check.status).toBe(404);
  });

  it('denies restore when the caller has read but not write access', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const org = { id: randomUUID(), name: 'Read-only Org' };
    const project = await createProject(db, {
      name: 'Board',
      orgId: org.id,
      workspaceId: randomUUID(),
    });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Locked',
      description: 'v0',
    });
    const revision = await insertRevision(db, {
      projectId: project.id,
      targetType: 'task',
      targetId: task.id,
      snapshot: JSON.stringify({ label: 'Locked', description: 'v0' }),
      changedFields: JSON.stringify(['description']),
      author: 'human:owner',
    });

    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) {
      throw new Error('expected better-auth');
    }
    await runBetterAuthMigrations(auth);

    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const user = await adapter.create<{ id: string }>({
      model: 'user',
      data: {
        name: 'Reader',
        email: `reader-${randomUUID()}@example.com`,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create({
      model: 'account',
      data: {
        accountId: '9201',
        providerId: 'github',
        userId: user.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create({
      model: 'organization',
      data: {
        id: org.id,
        name: org.name,
        slug: `org-ro-${randomUUID().slice(0, 8)}`,
        createdAt: now,
      },
      forceAllowId: true,
    });
    await adapter.create({
      model: 'member',
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'owner',
        createdAt: now,
      },
    });

    const minted = await createScopedAgentKey({
      auth,
      userId: user.id,
      orgId: org.id,
      projectId: project.id,
      permissions: { task: ['read'] },
      name: 'read-only-restore',
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

    const res = await app.request(`/api/v1/revisions/${revision.id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${minted.key}` },
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });

  it('REVERT-PROOF: denies cross-org restore', async () => {
    const f = await seedCrossOrgFixture();
    const res = await f.app.request(`/api/v1/revisions/${f.revision.id}/restore`, {
      method: 'POST',
      headers: f.bearer,
    });
    expect(res.status).toBe(404);
  });
});
