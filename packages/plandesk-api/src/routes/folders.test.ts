import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createProjectInDefaultOrg as createProject,
  getDocument,
  getFolder,
} from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type FolderResponse = {
  id: string;
  project_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
};

describe('folders routes', () => {
  it('creates, lists, gets, patches, and deletes a folder', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Folders' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Specs' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<FolderResponse>(createRes);
    expect(created.project_id).toBe(project.id);
    expect(created.name).toBe('Specs');
    expect(created.parent_folder_id).toBeNull();

    const listRes = await app.request(`/api/v1/projects/${project.id}/folders`);
    expect(listRes.status).toBe(200);
    const list = await parseJson<FolderResponse[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    const getRes = await app.request(`/api/v1/folders/${created.id}`);
    expect(getRes.status).toBe(200);
    expect((await parseJson<FolderResponse>(getRes)).name).toBe('Specs');

    const patchRes = await app.request(`/api/v1/folders/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(patchRes.status).toBe(200);
    expect((await parseJson<FolderResponse>(patchRes)).name).toBe('Renamed');

    const deleteRes = await app.request(`/api/v1/folders/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);
    const afterGet = await app.request(`/api/v1/folders/${created.id}`);
    expect(afterGet.status).toBe(404);
  });

  it('nests a folder under a parent and re-parents to root', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Nesting' });

    const parentRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Parent' }),
    });
    const parent = await parseJson<FolderResponse>(parentRes);

    const childRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Child', parent_folder_id: parent.id }),
    });
    expect(childRes.status).toBe(201);
    const child = await parseJson<FolderResponse>(childRes);
    expect(child.parent_folder_id).toBe(parent.id);

    const patchRes = await app.request(`/api/v1/folders/${child.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_folder_id: null }),
    });
    expect(patchRes.status).toBe(200);
    expect((await parseJson<FolderResponse>(patchRes)).parent_folder_id).toBeNull();
  });

  it('PATCH rejects a re-parent that would create a cycle with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Cycles' });

    const aRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A' }),
    });
    const a = await parseJson<FolderResponse>(aRes);
    const bRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B', parent_folder_id: a.id }),
    });
    const b = await parseJson<FolderResponse>(bRes);

    const selfRes = await app.request(`/api/v1/folders/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_folder_id: a.id }),
    });
    expect(selfRes.status).toBe(400);

    const cycleRes = await app.request(`/api/v1/folders/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_folder_id: b.id }),
    });
    expect(cycleRes.status).toBe(400);
    expect(await parseJson<{ error: string }>(cycleRes)).toMatchObject({
      error: 'invalid_argument',
    });
  });

  it('DELETE moves child folders and documents to the parent instead of orphaning', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Delete semantics' });

    const rootRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Root' }),
    });
    const root = await parseJson<FolderResponse>(rootRes);
    const midRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mid', parent_folder_id: root.id }),
    });
    const mid = await parseJson<FolderResponse>(midRes);
    const leafRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leaf', parent_folder_id: mid.id }),
    });
    const leaf = await parseJson<FolderResponse>(leafRes);
    const doc = await createDocument(db, {
      projectId: project.id,
      title: 'In mid',
      folderId: mid.id,
    });

    const deleteRes = await app.request(`/api/v1/folders/${mid.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);
    expect((await getFolder(db, leaf.id))?.parentFolderId).toBe(root.id);
    expect((await getDocument(db, doc.id))?.folderId).toBe(root.id);
  });

  it('POST rejects missing or blank name with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Validate' });

    const noName = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(noName.status).toBe(400);

    const blankName = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blankName.status).toBe(400);
  });

  it('returns 404 for missing project list and missing folder', async () => {
    const { app } = await createTestApp();
    const listRes = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/folders',
    );
    expect(listRes.status).toBe(404);

    const getRes = await app.request('/api/v1/folders/00000000-0000-4000-8000-000000009999');
    expect(getRes.status).toBe(404);

    const delRes = await app.request('/api/v1/folders/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(404);
  });

  it('documents routes accept folder_id on create and patch', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Docs in folders' });
    const folderRes = await app.request(`/api/v1/projects/${project.id}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Specs' }),
    });
    const folder = await parseJson<FolderResponse>(folderRes);

    const docRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Spec', folder_id: folder.id }),
    });
    expect(docRes.status).toBe(201);
    const doc = await parseJson<{ id: string; folder_id: string | null }>(docRes);
    expect(doc.folder_id).toBe(folder.id);

    const patchRes = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: null }),
    });
    expect(patchRes.status).toBe(200);
    expect((await parseJson<{ folder_id: string | null }>(patchRes)).folder_id).toBeNull();
  });
});
