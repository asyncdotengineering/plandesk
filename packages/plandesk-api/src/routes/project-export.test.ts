import { randomUUID } from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import {
  createProjectInDefaultOrg as createProject,
  createTaskWithDefaultGoal,
  SAVED_VIEW_CONFIG_VERSION,
  type SavedViewConfig,
} from '@plandesk/db';
import { createTestApp } from '../test-helpers.js';
import { readXlsxTable } from '../export/render.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function baseView(overrides: Partial<SavedViewConfig> = {}): SavedViewConfig {
  return {
    version: SAVED_VIEW_CONFIG_VERSION,
    filter: null,
    sort: [],
    group: null,
    visibleColumns: ['label', 'status', 'description'],
    ...overrides,
  };
}

async function exportProject(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  projectId: string,
  body: { format: 'csv' | 'xlsx'; view: SavedViewConfig },
): Promise<Response> {
  return app.request(`/api/v1/projects/${projectId}/export`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe('POST /projects/:id/export', () => {
  it('round-trips a description with comma, quote, and newline through CSV (RFC 4180)', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Quotes' });
    const awkward = 'Hello, "world"\nsecond paragraph';
    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'Awkward description',
      description: awkward,
      status: 'todo',
    });

    const res = await exportProject(app, project.id, {
      format: 'csv',
      view: baseView({ visibleColumns: ['label', 'description'] }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Raw CSV must quote the field (comma + quote + newline force quoting).
    expect(text).toMatch(/"Hello, ""world""\r?\nsecond paragraph"/);

    const records: Array<{ Label: string; Description: string }> = parseCsv(text, {
      columns: true,
      relax_quotes: false,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.Description).toBe(awkward);
  });

  it('denies a caller without access to the project for both formats', async () => {
    const {
      createDb,
      migrate,
      createProject: createProjectRaw,
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
    const projectA = await createProjectRaw(db, {
      name: 'Secret board',
      orgId: orgA.id,
      workspaceId: wsA,
    });
    await createTaskWithDefaultGoal(db, {
      projectId: projectA.id,
      label: 'Hidden',
      description: 'should not leak',
      status: 'todo',
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
        email: 'b-export@example.com',
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
        userId: userB.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create({
      model: 'organization',
      data: { id: orgB.id, name: orgB.name, slug: 'org-b-export', createdAt: now },
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
      name: 'b-export-key',
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
    const bearer = { Authorization: `Bearer ${keyB.key}`, ...JSON_HEADERS };
    const view = baseView();

    const csvDenied = await app.request(`/api/v1/projects/${projectA.id}/export`, {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ format: 'csv', view }),
    });
    expect(csvDenied.status).toBe(404);

    const xlsxDenied = await app.request(`/api/v1/projects/${projectA.id}/export`, {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ format: 'xlsx', view }),
    });
    expect(xlsxDenied.status).toBe(404);
  });

  it('exports filtered and grouped rows in visible order with a Group column', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Filtered' });

    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'Keep A',
      status: 'todo',
      assignee: 'ada',
      description: 'a',
    });
    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'Drop done',
      status: 'done',
      assignee: 'ada',
      description: 'b',
    });
    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'Keep B',
      status: 'todo',
      assignee: 'bob',
      description: 'c',
    });

    const view = baseView({
      filter: {
        kind: 'condition',
        field: 'status',
        operator: 'is',
        value: 'todo',
      },
      sort: [{ field: 'label', direction: 'asc' }],
      group: [{ field: 'assignee', direction: 'asc' }],
      visibleColumns: ['label', 'status', 'assignee'],
    });

    const res = await exportProject(app, project.id, { format: 'csv', view });
    expect(res.status).toBe(200);
    const text = await res.text();
    const records: Array<Record<string, string>> = parseCsv(text, { columns: true });

    expect(records.map((row) => row.Label)).toEqual(['Keep A', 'Keep B']);
    expect(records.every((row) => row.Status === 'todo')).toBe(true);
    expect(records[0]?.Group).toBe('ada');
    expect(records[1]?.Group).toBe('bob');
    expect(records.some((row) => row.Label === 'Drop done')).toBe(false);
  });

  it('XLSX contains the same extracted values as CSV for the same view', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Parity' });
    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'One',
      status: 'todo',
      description: 'd1',
      assignee: 'ada',
    });
    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'Two',
      status: 'in_progress',
      description: 'd2',
      assignee: 'bob',
    });

    const view = baseView({
      sort: [{ field: 'label', direction: 'asc' }],
      group: [{ field: 'status', direction: 'asc' }],
      visibleColumns: ['label', 'status', 'description'],
    });

    const csvRes = await exportProject(app, project.id, { format: 'csv', view });
    const xlsxRes = await exportProject(app, project.id, { format: 'xlsx', view });
    expect(csvRes.status).toBe(200);
    expect(xlsxRes.status).toBe(200);

    const csvText = await csvRes.text();
    const csvMatrix: string[][] = parseCsv(csvText, { relax_column_count: true });

    const xlsxBytes = new Uint8Array(await xlsxRes.arrayBuffer());
    const xlsxTable = await readXlsxTable(xlsxBytes);
    const xlsxMatrix = [xlsxTable.headers, ...xlsxTable.rows];

    expect(xlsxMatrix).toEqual(csvMatrix);
  });

  it('filename carries the project name and the date', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Acme Board' });
    await createTaskWithDefaultGoal(db, {
      projectId: project.id,
      label: 'T',
      status: 'todo',
    });

    const res = await exportProject(app, project.id, {
      format: 'csv',
      view: baseView(),
    });
    expect(res.status).toBe(200);
    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/Acme-Board-\d{4}-\d{2}-\d{2}\.csv"/);

    const xlsxRes = await exportProject(app, project.id, {
      format: 'xlsx',
      view: baseView(),
    });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get('Content-Disposition')).toMatch(
      /Acme-Board-\d{4}-\d{2}-\d{2}\.xlsx"/,
    );
  });
});
