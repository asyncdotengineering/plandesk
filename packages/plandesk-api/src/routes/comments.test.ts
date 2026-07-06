import { describe, expect, it } from 'vitest';
import {
  createComment,
  createDocument,
  createNote,
  createProject,
  createTask,
  getOrCreateDefaultGoal,
  upsertSubmission,
} from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';
import type { PlankDeskEvent } from '../events.js';

type CommentResponse = {
  id: string;
  target_type: string;
  target_id: string;
  document_id: string | null;
  passage: string | null;
  anchor: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
};

describe('comments routes', () => {
  it('creates, lists, updates, and deletes document comments via REST', async () => {
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
      target_type: 'document',
      target_id: doc.id,
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
      target_type: 'document',
      target_id: doc.id,
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
      target_type: 'document',
      target_id: doc.id,
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

  it('creates and lists task and note comments via REST', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Targets' });
    const goalId = getOrCreateDefaultGoal(db, project.id).id;
    const task = createTask(db, { projectId: project.id, goalId, label: 'Ship' });
    const note = createNote(db, { projectId: project.id, title: 'Memo' });

    const taskCreateRes = await app.request(`/api/v1/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Task feedback' }),
    });
    expect(taskCreateRes.status).toBe(201);
    const taskComment = await parseJson<CommentResponse>(taskCreateRes);
    expect(taskComment).toMatchObject({
      target_type: 'task',
      target_id: task.id,
      document_id: null,
      body: 'Task feedback',
    });

    const noteCreateRes = await app.request(`/api/v1/notes/${note.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Note feedback' }),
    });
    expect(noteCreateRes.status).toBe(201);
    const noteComment = await parseJson<CommentResponse>(noteCreateRes);
    expect(noteComment).toMatchObject({
      target_type: 'note',
      target_id: note.id,
      document_id: null,
      body: 'Note feedback',
    });

    const taskListRes = await app.request(`/api/v1/tasks/${task.id}/comments`);
    expect(await parseJson<CommentResponse[]>(taskListRes)).toHaveLength(1);

    const noteListRes = await app.request(`/api/v1/notes/${note.id}/comments`);
    expect(await parseJson<CommentResponse[]>(noteListRes)).toHaveLength(1);
  });

  it('creates and lists submission comments via REST', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Submissions' });
    upsertSubmission(db, {
      id: 'sub-1',
      projectId: project.id,
      hostedShareId: 'hosted-share-1',
      participantName: 'Alex',
      title: 'Bug report',
      body: 'Something broke',
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
      pulledAt: new Date('2026-01-15T12:01:00.000Z'),
    });

    const createRes = await app.request('/api/v1/submissions/sub-1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Needs triage context' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<CommentResponse>(createRes);
    expect(created).toMatchObject({
      target_type: 'submission',
      target_id: 'sub-1',
      document_id: null,
      body: 'Needs triage context',
    });

    const listRes = await app.request('/api/v1/submissions/sub-1/comments');
    expect(listRes.status).toBe(200);
    expect(await parseJson<CommentResponse[]>(listRes)).toHaveLength(1);
  });

  it('creates and lists project-scoped artifact annotations with an anchor', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Artifacts' });
    const artifactId = 'sha256:abc123::docs/report with spaces.md';
    const anchor = JSON.stringify({ type: 'TextQuoteSelector', exact: 'CSP', start: 10, end: 13 });

    const createRes = await app.request(`/api/v1/projects/${project.id}/artifact-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: artifactId, body: 'Check this', passage: 'CSP', anchor }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<CommentResponse>(createRes);
    expect(created.target_type).toBe('artifact');
    expect(created.target_id).toBe(artifactId);
    expect(created.anchor).toBe(anchor);

    const listRes = await app.request(
      `/api/v1/projects/${project.id}/artifact-comments?artifact_id=${encodeURIComponent(artifactId)}`,
    );
    expect(listRes.status).toBe(200);
    const listed = await parseJson<CommentResponse[]>(listRes);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    // Missing artifact_id → 400; unknown project → 404.
    const badRes = await app.request(`/api/v1/projects/${project.id}/artifact-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'No artifact id' }),
    });
    expect(badRes.status).toBe(400);
    const missingProjectRes = await app.request(
      `/api/v1/projects/00000000-0000-4000-8000-000000009999/artifact-comments?artifact_id=x`,
    );
    expect(missingProjectRes.status).toBe(404);
  });

  it('returns 400 for empty body and 404 for missing resources', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Validate' });
    const goalId = getOrCreateDefaultGoal(db, project.id).id;
    const doc = createDocument(db, { projectId: project.id, title: 'Doc' });
    const task = createTask(db, { projectId: project.id, goalId, label: 'Task' });
    const note = createNote(db, { projectId: project.id, title: 'Note' });
    const missing = '00000000-0000-4000-8000-000000009999';

    const emptyRes = await app.request(`/api/v1/documents/${doc.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '   ' }),
    });
    expect(emptyRes.status).toBe(400);

    const missingDocRes = await app.request(`/api/v1/documents/${missing}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hi' }),
    });
    expect(missingDocRes.status).toBe(404);

    const missingTaskRes = await app.request(`/api/v1/tasks/${missing}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hi' }),
    });
    expect(missingTaskRes.status).toBe(404);

    const missingNoteRes = await app.request(`/api/v1/notes/${missing}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hi' }),
    });
    expect(missingNoteRes.status).toBe(404);

    const missingSubmissionRes = await app.request(`/api/v1/submissions/${missing}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hi' }),
    });
    expect(missingSubmissionRes.status).toBe(404);

    const missingProjectRes = await app.request(`/api/v1/projects/${missing}/comments`);
    expect(missingProjectRes.status).toBe(404);

    const missingPatchRes = await app.request(`/api/v1/comments/${missing}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: true }),
    });
    expect(missingPatchRes.status).toBe(404);

    const missingDeleteRes = await app.request(`/api/v1/comments/${missing}`, { method: 'DELETE' });
    expect(missingDeleteRes.status).toBe(404);

    expect(task.id).toBeTruthy();
    expect(note.id).toBeTruthy();
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
