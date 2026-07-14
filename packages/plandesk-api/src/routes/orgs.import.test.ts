import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTaskWithDefaultGoal as createTask,
  createToken,
  createEdge,
  createDocument,
  createGoal,
  createFile,
  ensureDefaultOrg,
  exportProject,
  getFile,
  getProject,
  importProject,
  PLANDESK_EXPORT_VERSION,
} from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

describe('POST /api/v1/orgs/:id/import', () => {
  it('test:push_export_roundtrip — local export → hosted import → re-export deep-equal graph', async () => {
    const { app, db } = await createTestApp();
    const org = await ensureDefaultOrg(db);
    const token = await createToken(db, { name: 'owner', orgId: org.id, scope: 'full' });

    // Local workspace graph (same process, separate project — models pre-promote state).
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
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

    // Deep-equal graph by content (ids remapped on import).
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
    ]);
  });

  it('rejects import into org-B with an org-A token', async () => {
    const { app, db } = await createTestApp();
    const orgA = await ensureDefaultOrg(db);
    const orgB = await createOrg(db, { name: 'Org B' });
    const tokenA = await createToken(db, { name: 'A', orgId: orgA.id, scope: 'full' });

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
        Authorization: `Bearer ${tokenA.token}`,
      },
      body: JSON.stringify(exported),
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('importing the same file bytes into two different orgs does not collide', async () => {
    const { app, db } = await createTestApp();
    const orgA = await ensureDefaultOrg(db);
    const orgB = await createOrg(db, { name: 'Org B' });
    const tokenA = await createToken(db, { name: 'A', orgId: orgA.id, scope: 'full' });
    const tokenB = await createToken(db, { name: 'B', orgId: orgB.id, scope: 'full' });

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
        Authorization: `Bearer ${tokenA.token}`,
      },
      body: JSON.stringify(exported),
    });
    expect(resA.status).toBe(201);
    const { globalProjectId: projectA } = await parseJson<{ globalProjectId: string }>(resA);

    const resB = await app.request(`/api/v1/orgs/${orgB.id}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB.token}`,
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
    ]);
  });
});

describe('importProject orgId option', () => {
  it('places the project in the given org', async () => {
    const { db } = await createTestApp();
    const orgB = await createOrg(db, { name: 'Target' });
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
