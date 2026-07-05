import { describe, expect, it } from 'vitest';
import { createComment, createDocument, createProject } from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';
import type { PlankDeskEvent } from '../events.js';

type CommentResponse = {
  id: string;
  document_id: string;
  passage: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

describe('comments routes', () => {
  it('creates, lists, updates, and deletes comments via REST', async () => {
    const { app, eventBus } = createTestApp();
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Comments' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const docRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Spec' }),
    });
    const doc = await parseJson<{ id: string }>(docRes);

    const createRes = await app.request(`/api/v1/documents/${doc.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Revise intro', passage: '§1' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<CommentResponse>(createRes);
    expect(created).toMatchObject({
      document_id: doc.id,
      body: 'Revise intro',
      passage: '§1',
      resolved: false,
    });
    expect(received).toContainEqual({
      type: 'comment_created',
      commentId: created.id,
      documentId: doc.id,
      projectId: project.id,
    });

    const listRes = await app.request(`/api/v1/documents/${doc.id}/comments`);
    expect(listRes.status).toBe(200);
    const listed = await parseJson<CommentResponse[]>(listRes);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const projectListRes = await app.request(`/api/v1/projects/${project.id}/comments`);
    expect(projectListRes.status).toBe(200);
    const projectListed = await parseJson<CommentResponse[]>(projectListRes);
    expect(projectListed).toHaveLength(1);

    const patchRes = await app.request(`/api/v1/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Updated', resolved: true }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<CommentResponse>(patchRes);
    expect(updated.body).toBe('Updated');
    expect(updated.resolved).toBe(true);
    expect(received).toContainEqual({
      type: 'comment_updated',
      commentId: created.id,
      documentId: doc.id,
      projectId: project.id,
    });

    const openOnlyRes = await app.request(`/api/v1/documents/${doc.id}/comments`);
    expect(await parseJson<CommentResponse[]>(openOnlyRes)).toHaveLength(0);

    const resolvedRes = await app.request(
      `/api/v1/documents/${doc.id}/comments?include_resolved=true`,
    );
    expect(await parseJson<CommentResponse[]>(resolvedRes)).toHaveLength(1);

    const deleteRes = await app.request(`/api/v1/comments/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);

    const afterDelete = await app.request(
      `/api/v1/documents/${doc.id}/comments?include_resolved=true`,
    );
    expect(await parseJson<CommentResponse[]>(afterDelete)).toHaveLength(0);
  });

  it('returns 400 for empty body and 404 for missing resources', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Validate' });
    const doc = createDocument(db, { projectId: project.id, title: 'Doc' });

    const emptyRes = await app.request(`/api/v1/documents/${doc.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '   ' }),
    });
    expect(emptyRes.status).toBe(400);

    const missingDocRes = await app.request(
      '/api/v1/documents/00000000-0000-4000-8000-000000009999/comments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Hi' }),
      },
    );
    expect(missingDocRes.status).toBe(404);

    const missingProjectRes = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/comments',
    );
    expect(missingProjectRes.status).toBe(404);

    const missingPatchRes = await app.request(
      '/api/v1/comments/00000000-0000-4000-8000-000000009999',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      },
    );
    expect(missingPatchRes.status).toBe(404);

    const missingDeleteRes = await app.request(
      '/api/v1/comments/00000000-0000-4000-8000-000000009999',
      { method: 'DELETE' },
    );
    expect(missingDeleteRes.status).toBe(404);
  });

  it('deleting a document cascades comments', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Cascade doc' });
    const doc = createDocument(db, { projectId: project.id, title: 'Doc' });
    const comment = createComment(db, {
      projectId: project.id,
      targetType: 'document',
      targetId: doc.id,
      body: 'Orphan?',
    });

    const deleteRes = await app.request(`/api/v1/documents/${doc.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);

    const listRes = await app.request(
      `/api/v1/projects/${project.id}/comments?include_resolved=true`,
    );
    expect(await parseJson<CommentResponse[]>(listRes)).toHaveLength(0);
    expect(comment.id).toBeTruthy();
  });
});
