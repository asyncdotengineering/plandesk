import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createDocumentComment,
  createProject,
  getDocumentComment,
  listCommentsByDocument,
  migrate,
} from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createCommentService, InvalidCommentError } from './comments.js';

describe('commentService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';
  let documentId = '';

  function createService() {
    return createCommentService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM document_comments');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Comments' }).id;
    documentId = createDocument(db, { projectId, title: 'Doc' }).id;
  });

  it('creates a comment and emits comment_created', () => {
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const service = createService();
    const comment = service.create(documentId, {
      body: 'Fix this section',
      passage: '§2',
    });

    expect(comment).toMatchObject({
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
    });
  });

  it('rejects empty body on create and update', () => {
    const service = createService();
    expect(() => service.create(documentId, { body: '   ' })).toThrow(InvalidCommentError);

    const created = createDocumentComment(db, { documentId, body: 'Valid' });
    expect(() => service.update(created.id, { body: '' })).toThrow(InvalidCommentError);
  });

  it('lists comments by document and project with resolved filter', () => {
    const service = createService();
    const open = createDocumentComment(db, { documentId, body: 'Open' });
    const resolved = createDocumentComment(db, { documentId, body: 'Done' });
    service.update(resolved.id, { resolved: true });

    expect(service.listByDocument(documentId)?.map((c) => c.id)).toEqual([open.id]);
    expect(service.listByDocument(documentId, { includeResolved: true })).toHaveLength(2);
    expect(service.listByProject(projectId)?.map((c) => c.id)).toEqual([open.id]);
  });

  it('returns undefined for missing document or project', () => {
    const service = createService();
    expect(service.create('00000000-0000-4000-8000-000000009999', { body: 'x' })).toBeUndefined();
    expect(service.listByDocument('00000000-0000-4000-8000-000000009999')).toBeUndefined();
    expect(service.listByProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates and deletes comments with comment_updated events', () => {
    const received: PlankDeskEvent[] = [];
    eventBus.subscribe((event) => {
      received.push(event);
    });

    const service = createService();
    const created = service.create(documentId, { body: 'Before' });
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
    });

    expect(service.delete(created.id)).toBe(true);
    expect(getDocumentComment(db, created.id)).toBeUndefined();
    expect(listCommentsByDocument(db, documentId, { includeResolved: true })).toHaveLength(0);
    expect(received.filter((e) => e.type === 'comment_updated')).toHaveLength(2);
  });
});
