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
} from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createCommentService, InvalidCommentError } from './comments.js';

describe('commentService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';
  let documentId = '';
  let taskId = '';
  let noteId = '';

  function createService() {
    return createCommentService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM comments');
    db.$client.exec('DELETE FROM notes');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Comments' }).id;
    const goalId = getOrCreateDefaultGoal(db, projectId).id;
    documentId = createDocument(db, { projectId, title: 'Doc' }).id;
    taskId = createTask(db, { projectId, goalId, label: 'Task' }).id;
    noteId = createNote(db, { projectId, title: 'Note' }).id;
  });

  it('creates a comment and emits comment_created', () => {
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const service = createService();
    const comment = service.create(
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

  it('creates comments on tasks and notes', () => {
    const service = createService();
    const taskComment = service.create({ type: 'task', id: taskId }, { body: 'Task note' });
    const noteComment = service.create({ type: 'note', id: noteId }, { body: 'Note note' });

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

  it('rejects empty body on create and update', () => {
    const service = createService();
    expect(() => service.create({ type: 'document', id: documentId }, { body: '   ' })).toThrow(
      InvalidCommentError,
    );

    const created = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Valid',
    });
    expect(() => service.update(created.id, { body: '' })).toThrow(InvalidCommentError);
  });

  it('lists comments by target and project with resolved filter', () => {
    const service = createService();
    const open = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Open',
    });
    const resolved = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Done',
    });
    service.update(resolved.id, { resolved: true });

    expect(service.listByTarget({ type: 'document', id: documentId })?.map((c) => c.id)).toEqual([
      open.id,
    ]);
    expect(
      service.listByTarget({ type: 'document', id: documentId }, { includeResolved: true }),
    ).toHaveLength(2);
    expect(service.listByDocument(documentId)?.map((c) => c.id)).toEqual([open.id]);
    expect(service.listByProject(projectId)?.map((c) => c.id)).toEqual([open.id]);
  });

  it('returns undefined for missing targets or project', () => {
    const service = createService();
    const missing = '00000000-0000-4000-8000-000000009999';
    expect(service.create({ type: 'document', id: missing }, { body: 'x' })).toBeUndefined();
    expect(service.listByTarget({ type: 'task', id: missing })).toBeUndefined();
    expect(service.listByDocument(missing)).toBeUndefined();
    expect(service.listByProject(missing)).toBeUndefined();
  });

  it('updates and deletes comments with comment_updated events', () => {
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const service = createService();
    const created = service.create({ type: 'document', id: documentId }, { body: 'Before' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }

    const updated = service.update(created.id, { body: 'After', resolved: true });
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

    expect(service.delete(created.id)).toBe(true);
    expect(getComment(db, created.id)).toBeUndefined();
    expect(
      listCommentsByTarget(db, 'document', documentId, { includeResolved: true }),
    ).toHaveLength(0);
    expect(received.filter((e) => e.type === 'comment_updated')).toHaveLength(2);
  });

  it('updates and deletes task comments', () => {
    const service = createService();
    const created = service.create({ type: 'task', id: taskId }, { body: 'Task feedback' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }

    const updated = service.update(created.id, { resolved: true });
    expect(updated?.resolved).toBe(true);

    expect(service.delete(created.id)).toBe(true);
    expect(listCommentsByTarget(db, 'task', taskId, { includeResolved: true })).toHaveLength(0);
  });
});
