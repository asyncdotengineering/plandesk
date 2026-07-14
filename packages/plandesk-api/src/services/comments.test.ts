import { beforeEach, describe, expect, it } from 'vitest';
import {
  createComment,
  createDb,
  createDocument,
  createNote,
  createProject,
  createTask,
  getComment,
  getOrCreateDefaultGoal,
  listCommentsByTarget,
  migrate,
  upsertSubmission,
  type Db,
} from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createCommentService, InvalidCommentError } from './comments.js';

describe('commentService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();
  let projectId = '';
  let documentId = '';
  let taskId = '';
  let noteId = '';
  let submissionId = '';

  function createService() {
    return createCommentService({ db, eventBus });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM comments');
    await db.$client.execute('DELETE FROM share_submissions');
    await db.$client.execute('DELETE FROM notes');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    projectId = (await createProject(db, { name: 'Comments' })).id;
    const goalId = (await getOrCreateDefaultGoal(db, projectId)).id;
    documentId = (await createDocument(db, { projectId, title: 'Doc' })).id;
    taskId = (await createTask(db, { projectId, goalId, label: 'Task' })).id;
    noteId = (await createNote(db, { projectId, title: 'Note' })).id;
    submissionId = 'sub-1';
    await upsertSubmission(db, {
      id: submissionId,
      projectId,
      hostedShareId: 'hosted-share-1',
      participantName: 'Alex',
      title: 'Bug report',
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
      pulledAt: new Date('2026-01-15T12:01:00.000Z'),
    });
  });

  it('creates a comment and emits comment_created', async () => {
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const service = createService();
    const comment = await service.create(
      { type: 'document', id: documentId },
      {
        body: 'Fix this section',
        passage: '§2',
      },
    );

    expect(comment).toMatchObject({
      target_type: 'document',
      target_id: documentId,
      document_id: documentId,
      body: 'Fix this section',
      passage: '§2',
      resolved: false,
    });
    expect(comment?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(received).toContainEqual({
      type: 'comment_created',
      commentId: comment?.id,
      documentId,
      projectId,
      target_type: 'document',
      target_id: documentId,
    });
  });

  it('creates comments on tasks and notes', async () => {
    const service = createService();
    const taskComment = await service.create({ type: 'task', id: taskId }, { body: 'Task note' });
    const noteComment = await service.create({ type: 'note', id: noteId }, { body: 'Note note' });

    expect(taskComment).toMatchObject({
      target_type: 'task',
      target_id: taskId,
      document_id: null,
      body: 'Task note',
    });
    expect(noteComment).toMatchObject({
      target_type: 'note',
      target_id: noteId,
      document_id: null,
      body: 'Note note',
    });
  });

  it('creates comments on submissions', async () => {
    const service = createService();
    const submissionComment = await service.create(
      { type: 'submission', id: submissionId },
      { body: 'Submission note' },
    );

    expect(submissionComment).toMatchObject({
      target_type: 'submission',
      target_id: submissionId,
      document_id: null,
      body: 'Submission note',
    });
  });

  it('rejects empty body on create and update', async () => {
    const service = createService();
    await expect(service.create({ type: 'document', id: documentId }, { body: '   ' })).rejects.toThrow(
      InvalidCommentError,
    );

    const created = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Valid',
    });
    await expect(service.update(created.id, { body: '' })).rejects.toThrow(InvalidCommentError);
  });

  it('lists comments by target and project with resolved filter', async () => {
    const service = createService();
    const open = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Open',
    });
    const resolved = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Done',
    });
    await service.update(resolved.id, { resolved: true });

    expect((await service.listByTarget({ type: 'document', id: documentId }))?.map((c) => c.id)).toEqual([
      open.id,
    ]);
    expect(
      await service.listByTarget({ type: 'document', id: documentId }, { includeResolved: true }),
    ).toHaveLength(2);
    expect((await service.listByDocument(documentId))?.map((c) => c.id)).toEqual([open.id]);
    expect((await service.listByProject(projectId))?.map((c) => c.id)).toEqual([open.id]);
  });

  it('returns undefined for missing targets or project', async () => {
    const service = createService();
    const missing = '00000000-0000-4000-8000-000000009999';
    expect(await service.create({ type: 'document', id: missing }, { body: 'x' })).toBeUndefined();
    expect(await service.listByTarget({ type: 'task', id: missing })).toBeUndefined();
    expect(await service.listByDocument(missing)).toBeUndefined();
    expect(await service.listByProject(missing)).toBeUndefined();
  });

  it('updates and deletes comments with comment_updated events', async () => {
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const service = createService();
    const created = await service.create({ type: 'document', id: documentId }, { body: 'Before' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }

    const updated = await service.update(created.id, { body: 'After', resolved: true });
    expect(updated?.body).toBe('After');
    expect(updated?.resolved).toBe(true);
    expect(received).toContainEqual({
      type: 'comment_updated',
      commentId: created.id,
      documentId,
      projectId,
      target_type: 'document',
      target_id: documentId,
    });

    expect(await service.delete(created.id)).toBe(true);
    expect(await getComment(db, created.id)).toBeUndefined();
    expect(
      await listCommentsByTarget(db, 'document', documentId, { includeResolved: true }),
    ).toHaveLength(0);
    expect(received.filter((e) => e.type === 'comment_updated')).toHaveLength(2);
  });

  it('updates and deletes task comments', async () => {
    const service = createService();
    const created = await service.create({ type: 'task', id: taskId }, { body: 'Task feedback' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }

    const updated = await service.update(created.id, { resolved: true });
    expect(updated?.resolved).toBe(true);

    expect(await service.delete(created.id)).toBe(true);
    expect(await listCommentsByTarget(db, 'task', taskId, { includeResolved: true })).toHaveLength(0);
  });
});
