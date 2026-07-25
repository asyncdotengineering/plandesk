import { describe, expect, it } from 'vitest';
import { createEdge, createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createTestApp, parseJson } from '../test-helpers.js';

type EntityLink = {
  type: 'task' | 'document';
  id: string;
  title: string;
  label: string | null;
};

type DocumentResponse = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  status_line: string | null;
  parent_id: string | null;
  linked_task_id: string | null;
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
        linked_task_id: task.id,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<DocumentResponse>(createRes);
    expect(created.linked_task_id).toBe(task.id);
    expect(created.status_line).toBe('Status: draft');
    expect(created.links).toEqual([
      { type: 'task', id: task.id, title: 'Implement', label: 'documents' },
    ]);
    expect(created.backlinks).toEqual([]);

    const byTaskRes = await app.request(`/api/v1/tasks/${task.id}/document`);
    expect(byTaskRes.status).toBe(200);
    const linked = await parseJson<DocumentResponse>(byTaskRes);
    expect(linked.id).toBe(created.id);
    expect(linked.title).toBe('Implementation notes');

    const backlinksRes = await app.request(`/api/v1/tasks/${task.id}/backlinks`);
    expect(backlinksRes.status).toBe(200);
    const backlinks = await parseJson<EntityLink[]>(backlinksRes);
    expect(backlinks).toEqual([
      { type: 'document', id: created.id, title: 'Implementation notes', label: 'documents' },
    ]);
  });

  it('accepts linkedTaskId alias on create', async () => {
    const { app, db } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alias' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    const task = await createTask(db, { projectId: project.id, label: 'Task' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Alias doc',
        linkedTaskId: task.id,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<DocumentResponse>(createRes);
    expect(created.linked_task_id).toBe(task.id);
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
    expect(fetched.body).toBe('Hello');
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
    expect(updated.body).toBe('v2');
    expect(updated.status_line).toBe('Status: done');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );
  });

  it('rejects cross-project task link with 400', async () => {
    const { app, db } = await createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Main' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    const otherProject = await createProject(db, { name: 'Other' });
    const foreignTask = await createTask(db, { projectId: otherProject.id, label: 'Foreign' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Bad link',
        linked_task_id: foreignTask.id,
      }),
    });
    expect(createRes.status).toBe(400);
    expect(await parseJson(createRes)).toEqual({ error: 'invalid_argument' });
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
    expect(await parseJson(createRes)).toEqual({ error: 'invalid_argument' });
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
      body: JSON.stringify({ title: 'Doc A', linked_task_id: t1.id }),
    });
    const docA = await parseJson<DocumentResponse>(createA);
    const createB = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc B' }),
    });
    const docB = await parseJson<DocumentResponse>(createB);

    await createEdge(db, {
      projectId: project.id,
      fromType: 'document',
      fromId: docA.id,
      toType: 'task',
      toId: t2.id,
      label: 'documents',
    });
    await createEdge(db, {
      projectId: project.id,
      fromType: 'document',
      fromId: docA.id,
      toType: 'task',
      toId: t3.id,
      label: 'documents',
    });
    await createEdge(db, {
      projectId: project.id,
      fromType: 'document',
      fromId: docA.id,
      toType: 'document',
      toId: docB.id,
      fromTaskId: t1.id,
      toTaskId: t1.id,
      label: 'references',
    });

    const getA = await parseJson<DocumentResponse>(
      await app.request(`/api/v1/documents/${docA.id}`),
    );
    expect(getA.links.filter((l) => l.type === 'task')).toHaveLength(3);
    expect(getA.links.map((l) => l.id).sort()).toEqual(
      [t1.id, t2.id, t3.id, docB.id].sort(),
    );
    expect(getA.links).toContainEqual({
      type: 'document',
      id: docB.id,
      title: 'Doc B',
      label: 'references',
    });

    const getB = await parseJson<DocumentResponse>(
      await app.request(`/api/v1/documents/${docB.id}`),
    );
    expect(getB.backlinks).toEqual([
      { type: 'document', id: docA.id, title: 'Doc A', label: 'references' },
    ]);

    const docBacklinks = await parseJson<EntityLink[]>(
      await app.request(`/api/v1/documents/${docB.id}/backlinks`),
    );
    expect(docBacklinks).toEqual([
      { type: 'document', id: docA.id, title: 'Doc A', label: 'references' },
    ]);

    const taskBacklinks = await parseJson<EntityLink[]>(
      await app.request(`/api/v1/tasks/${t1.id}/backlinks`),
    );
    expect(taskBacklinks).toContainEqual({
      type: 'document',
      id: docA.id,
      title: 'Doc A',
      label: 'documents',
    });
  });
});
