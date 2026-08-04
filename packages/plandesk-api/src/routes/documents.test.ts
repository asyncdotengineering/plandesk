import { describe, expect, it } from 'vitest';
import { createEdge, createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { ensureHtmlBody } from '../markdown.js';
import { createTestApp, parseJson } from '../test-helpers.js';

type EntityLink = {
  type: 'task' | 'document' | 'artifact' | 'prototype';
  id: string;
  title: string;
  label: string | null;
  edge_id: string;
};

type DocumentResponse = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  links: EntityLink[];
  backlinks: EntityLink[];
  created_at: string;
  updated_at: string;
};

type DocumentTreeNode = DocumentResponse & {
  children: DocumentTreeNode[];
};

describe('documents routes', () => {
  it('test:doc_link creates a linked document and resolves via task endpoint', async () => {
    const { app, db } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Docs' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    const task = await createTask(db, { projectId: project.id, label: 'Implement' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Implementation notes',
        body: '# Notes',
        status_line: 'Status: draft',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<DocumentResponse>(createRes);
    expect(created.status_line).toBe('Status: draft');
    await createEdge(db, {
      projectId: project.id,
      fromType: 'document',
      fromId: created.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });
    const linkedGet = await app.request(`/api/v1/documents/${created.id}`);
    const linkedDoc = await parseJson<DocumentResponse>(linkedGet);
    const firstLink = linkedDoc.links[0];
    if (firstLink === undefined) {
      throw new Error('missing document link edge');
    }
    expect(linkedDoc.links).toEqual([
      {
        type: 'task',
        id: task.id,
        title: 'Implement',
        label: 'documents',
        edge_id: firstLink.edge_id,
      },
    ]);
    expect(typeof firstLink.edge_id).toBe('string');
    expect(linkedDoc.backlinks).toEqual([]);
    const linkEdgeId = firstLink.edge_id;

    const byTaskRes = await app.request(`/api/v1/tasks/${task.id}/document`);
    expect(byTaskRes.status).toBe(200);
    const linked = await parseJson<DocumentResponse>(byTaskRes);
    expect(linked.id).toBe(created.id);
    expect(linked.title).toBe('Implementation notes');

    const backlinksRes = await app.request(`/api/v1/tasks/${task.id}/backlinks`);
    expect(backlinksRes.status).toBe(200);
    const backlinks = await parseJson<EntityLink[]>(backlinksRes);
    expect(backlinks).toEqual([
      {
        type: 'document',
        id: created.id,
        title: 'Implementation notes',
        label: 'documents',
        edge_id: linkEdgeId,
      },
    ]);
  });

  it('GET /projects/:id/documents returns nested tree', async () => {
    const { app } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tree' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const parentRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Parent' }),
    });
    const parent = await parseJson<DocumentResponse>(parentRes);

    await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Child', parent_id: parent.id }),
    });

    const treeRes = await app.request(`/api/v1/projects/${project.id}/documents`);
    expect(treeRes.status).toBe(200);
    const tree = await parseJson<DocumentTreeNode[]>(treeRes);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.title).toBe('Parent');
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.title).toBe('Child');
    expect(tree[0]?.children[0]?.parent_id).toBe(parent.id);
  });

  it('GET /documents/:id returns document body', async () => {
    const { app } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Body' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const createRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc', body: 'Hello' }),
    });
    const created = await parseJson<DocumentResponse>(createRes);

    const getRes = await app.request(`/api/v1/documents/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await parseJson<DocumentResponse>(getRes);
    expect(fetched.body).toBe(ensureHtmlBody('Hello'));
  });

  it('PATCH /documents/:id updates fields', async () => {
    const { app } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Patch' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const createRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Before', body: 'v1' }),
    });
    const created = await parseJson<DocumentResponse>(createRes);

    const patchRes = await app.request(`/api/v1/documents/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'After',
        body: 'v2',
        status_line: 'Status: done',
      }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<DocumentResponse>(patchRes);
    expect(updated.title).toBe('After');
    expect(updated.body).toBe(ensureHtmlBody('v2'));
    expect(updated.status_line).toBe('Status: done');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );
  });

  it('returns 404 for missing project, document, and task document', async () => {
    const { app } = await createTestApp();

    const treeRes = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/documents',
    );
    expect(treeRes.status).toBe(404);

    const docRes = await app.request('/api/v1/documents/00000000-0000-4000-8000-000000009999');
    expect(docRes.status).toBe(404);

    const taskDocRes = await app.request(
      '/api/v1/tasks/00000000-0000-4000-8000-000000009999/document',
    );
    expect(taskDocRes.status).toBe(404);
  });

  it('POST rejects missing title', async () => {
    const { app } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Validate' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const createRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'No title' }),
    });
    expect(createRes.status).toBe(400);
    expect(await parseJson(createRes)).toMatchObject({ error: 'invalid_argument' });
  });

  it('DELETE /api/v1/documents/:id detaches children and deletes document', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Doc delete' });
    const parent = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Parent' }),
    });
    const parentDoc = await parseJson<DocumentResponse>(parent);
    const childRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Child', parent_id: parentDoc.id }),
    });
    const childDoc = await parseJson<DocumentResponse>(childRes);

    const deleteRes = await app.request(`/api/v1/documents/${parentDoc.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);

    const childGet = await app.request(`/api/v1/documents/${childDoc.id}`);
    const child = await parseJson<DocumentResponse>(childGet);
    expect(child.parent_id).toBeNull();

    const parentGet = await app.request(`/api/v1/documents/${parentDoc.id}`);
    expect(parentGet.status).toBe(404);
  });

  it('DELETE /api/v1/documents/:id returns 404 when missing', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/documents/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/projects/:id/documents returns 400 for invalid pagination', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Paginate docs' });
    const res = await app.request(`/api/v1/projects/${project.id}/documents?offset=-1`);
    expect(res.status).toBe(400);
  });

  it('document with three task links returns all three; doc→doc is bidirectional; task backlinks list docs', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Multi-link' });
    const t1 = await createTask(db, { projectId: project.id, label: 'T1' });
    const t2 = await createTask(db, { projectId: project.id, label: 'T2' });
    const t3 = await createTask(db, { projectId: project.id, label: 'T3' });

    const createA = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc A' }),
    });
    const docA = await parseJson<DocumentResponse>(createA);
    const createB = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc B' }),
    });
    const docB = await parseJson<DocumentResponse>(createB);

    for (const task of [t1, t2, t3]) {
      await createEdge(db, {
        projectId: project.id,
        fromType: 'document',
        fromId: docA.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });
    }
    await createEdge(db, {
      projectId: project.id,
      fromType: 'document',
      fromId: docA.id,
      toType: 'document',
      toId: docB.id,
      label: 'references',
    });

    const getA = await parseJson<DocumentResponse>(
      await app.request(`/api/v1/documents/${docA.id}`),
    );
    expect(getA.links.filter((l) => l.type === 'task')).toHaveLength(3);
    expect(getA.links.map((l) => l.id).sort()).toEqual(
      [t1.id, t2.id, t3.id, docB.id].sort(),
    );
    expect(getA.links).toContainEqual(
      expect.objectContaining({
        type: 'document',
        id: docB.id,
        title: 'Doc B',
        label: 'references',
      }),
    );
    const documentLink = getA.links.find((link) => link.id === docB.id);
    expect(typeof documentLink?.edge_id).toBe('string');

    const getB = await parseJson<DocumentResponse>(
      await app.request(`/api/v1/documents/${docB.id}`),
    );
    expect(getB.backlinks).toEqual([
      expect.objectContaining({
        type: 'document',
        id: docA.id,
        title: 'Doc A',
        label: 'references',
      }),
    ]);
    expect(typeof getB.backlinks[0]?.edge_id).toBe('string');

    const docBacklinks = await parseJson<EntityLink[]>(
      await app.request(`/api/v1/documents/${docB.id}/backlinks`),
    );
    expect(docBacklinks).toEqual([
      expect.objectContaining({
        type: 'document',
        id: docA.id,
        title: 'Doc A',
        label: 'references',
      }),
    ]);
    expect(typeof docBacklinks[0]?.edge_id).toBe('string');

    const taskBacklinks = await parseJson<EntityLink[]>(
      await app.request(`/api/v1/tasks/${t1.id}/backlinks`),
    );
    expect(taskBacklinks).toContainEqual(
      expect.objectContaining({
        type: 'document',
        id: docA.id,
        title: 'Doc A',
        label: 'documents',
      }),
    );
    const taskBacklink = taskBacklinks.find((link) => link.id === docA.id);
    expect(typeof taskBacklink?.edge_id).toBe('string');
  });

  it('REVERT-PROOF: a converted bullet lands on an active goal and is reachable once released', async () => {
    const { app } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Reachable' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    const createDoc = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Plan', body: '<ul><li><p>Ship it</p></li></ul>' }),
    });
    const document = await parseJson<{ id: string }>(createDoc);

    const convert = await app.request(`/api/v1/documents/${document.id}/convert-bullets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: ['Ship it'] }),
    });
    expect(convert.status).toBe(201);
    const { created } = await parseJson<{ created: Array<{ id: string }> }>(convert);
    const taskId = created[0]?.id;
    if (taskId === undefined) {
      throw new Error('expected convert-bullets to create a task');
    }

    // Storing a plausible goal_id is not the same as being schedulable: a task
    // on a completed goal reads back fine and is invisible to nextActionable
    // forever. Release it and prove the scheduler can actually see it.
    const release = await app.request(`/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo' }),
    });
    expect(release.status).toBe(200);

    const next = await app.request(`/api/v1/projects/${project.id}/next-task`);
    expect(next.status).toBe(200);
    const body = await parseJson<{ next_task: { id: string } | null }>(next);
    expect(body.next_task?.id).toBe(taskId);
  });

  it('POST /documents/:id/convert-bullets creates scope tasks and skips duplicates', async () => {
    const { app } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Convert' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    const createDoc = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Overview',
        body: '<ul><li><p>First</p></li><li><p>Second</p></li></ul>',
      }),
    });
    const document = await parseJson<{ id: string; body: string | null }>(createDoc);
    const bodyBefore = document.body;

    const first = await app.request(`/api/v1/documents/${document.id}/convert-bullets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: ['First', 'Second'] }),
    });
    expect(first.status).toBe(201);
    const created = await parseJson<{
      created: Array<{ id: string; label: string; status: string; y: number }>;
      skipped: string[];
    }>(first);
    expect(created.created.map((task) => task.label)).toEqual(['First', 'Second']);
    expect(created.created.every((task) => task.status === 'scope')).toBe(true);
    expect(created.skipped).toEqual([]);

    const second = await app.request(`/api/v1/documents/${document.id}/convert-bullets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: ['First', 'Second'] }),
    });
    expect(second.status).toBe(201);
    const skipped = await parseJson<{ created: unknown[]; skipped: string[] }>(second);
    expect(skipped.created).toEqual([]);
    expect(skipped.skipped).toEqual(['First', 'Second']);

    const after = await parseJson<{ body: string | null }>(
      await app.request(`/api/v1/documents/${document.id}`),
    );
    expect(after.body).toBe(bodyBefore);
  });
});
