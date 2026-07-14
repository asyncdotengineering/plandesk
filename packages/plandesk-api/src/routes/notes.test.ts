import { describe, expect, it } from 'vitest';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type NoteResponse = {
  id: string;
  project_id: string;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
};

describe('notes routes', () => {
  it('creates, lists, gets, patches, and deletes a note', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Notes' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Working note', body: '<p>scratch</p>' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<NoteResponse>(createRes);
    expect(created.project_id).toBe(project.id);
    expect(created.title).toBe('Working note');
    expect(created.body).toBe('<p>scratch</p>');

    const listRes = await app.request(`/api/v1/projects/${project.id}/notes`);
    expect(listRes.status).toBe(200);
    const list = await parseJson<NoteResponse[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    const getRes = await app.request(`/api/v1/notes/${created.id}`);
    expect(getRes.status).toBe(200);
    expect((await parseJson<NoteResponse>(getRes)).title).toBe('Working note');

    const patchRes = await app.request(`/api/v1/notes/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed', body: '<p>v2</p>' }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<NoteResponse>(patchRes);
    expect(updated.title).toBe('Renamed');
    expect(updated.body).toBe('<p>v2</p>');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );

    const deleteRes = await app.request(`/api/v1/notes/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);
    const afterGet = await app.request(`/api/v1/notes/${created.id}`);
    expect(afterGet.status).toBe(404);
  });

  it('POST rejects missing or blank title with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Validate' });

    const noTitle = await app.request(`/api/v1/projects/${project.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'No title' }),
    });
    expect(noTitle.status).toBe(400);

    const blankTitle = await app.request(`/api/v1/projects/${project.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    expect(blankTitle.status).toBe(400);
  });

  it('PATCH rejects blanking the title with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Patch validate' });
    const createRes = await app.request(`/api/v1/projects/${project.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Keep me' }),
    });
    const created = await parseJson<NoteResponse>(createRes);

    const patchRes = await app.request(`/api/v1/notes/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    expect(patchRes.status).toBe(400);
  });

  it('returns 404 for missing project list and missing note', async () => {
    const { app } = await createTestApp();
    const listRes = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/notes',
    );
    expect(listRes.status).toBe(404);

    const getRes = await app.request('/api/v1/notes/00000000-0000-4000-8000-000000009999');
    expect(getRes.status).toBe(404);

    const delRes = await app.request('/api/v1/notes/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(404);
  });

  it('GET /projects/:id/notes returns 400 for invalid pagination', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Paginate notes' });
    const res = await app.request(`/api/v1/projects/${project.id}/notes?offset=-1`);
    expect(res.status).toBe(400);
  });
});
