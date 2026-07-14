import { describe, expect, it } from 'vitest';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type ArtifactResponse = {
  id: string;
  project_id: string;
  title: string;
  kind: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type ArtifactSummary = {
  id: string;
  title: string;
  kind: string;
  updated_at: string;
};

describe('artifacts routes', () => {
  it('creates, lists, gets, patches, and returns 404 for missing artifact', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Artifacts' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'RFC draft',
        kind: 'markdown',
        content: '# Hello',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<ArtifactResponse>(createRes);
    expect(created.project_id).toBe(project.id);
    expect(created.title).toBe('RFC draft');
    expect(created.kind).toBe('markdown');
    expect(created.content).toBe('# Hello');

    const listRes = await app.request(`/api/v1/projects/${project.id}/artifacts`);
    expect(listRes.status).toBe(200);
    const list = await parseJson<ArtifactSummary[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: created.id,
      title: 'RFC draft',
      kind: 'markdown',
      updated_at: created.updated_at,
    });

    const getRes = await app.request(`/api/v1/artifacts/${created.id}`);
    expect(getRes.status).toBe(200);
    expect((await parseJson<ArtifactResponse>(getRes)).content).toBe('# Hello');

    const patchRes = await app.request(`/api/v1/artifacts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'RFC v2', content: '# Revised', kind: 'html' }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<ArtifactResponse>(patchRes);
    expect(updated.title).toBe('RFC v2');
    expect(updated.content).toBe('# Revised');
    expect(updated.kind).toBe('html');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );

    const missingGet = await app.request('/api/v1/artifacts/00000000-0000-4000-8000-000000009999');
    expect(missingGet.status).toBe(404);

    const missingList = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/artifacts',
    );
    expect(missingList.status).toBe(404);
  });

  it('POST rejects missing or blank title with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Validate' });

    const noTitle = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'No title' }),
    });
    expect(noTitle.status).toBe(400);

    const blankTitle = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    expect(blankTitle.status).toBe(400);
  });

  it('POST rejects invalid kind with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Kind validate' });

    const res = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad kind', kind: 'pdf' }),
    });
    expect(res.status).toBe(400);
  });
});