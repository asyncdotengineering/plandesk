import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createDocument } from './documents.js';
import { createProject } from './projects.js';
import {
  createDocumentComment,
  deleteCommentsByDocumentId,
  deleteCommentsByProjectId,
  deleteDocumentComment,
  getDocumentComment,
  listCommentsByDocument,
  listCommentsByProject,
  updateDocumentComment,
} from './document-comments.js';

describe('document-comments repository', () => {
  const db = createDb(':memory:');
  let projectId = '';
  let documentId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM document_comments');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Comments' }).id;
    documentId = createDocument(db, { projectId, title: 'Doc' }).id;
  });

  it('creates and retrieves a comment', () => {
    const created = createDocumentComment(db, {
      documentId,
      body: 'Needs revision',
      passage: 'Section 2',
    });
    const fetched = getDocumentComment(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.body).toBe('Needs revision');
    expect(fetched?.passage).toBe('Section 2');
    expect(fetched?.resolved).toBe(false);
  });

  it('lists comments by document ordered by created_at asc', () => {
    const first = createDocumentComment(db, { documentId, body: 'First' });
    const second = createDocumentComment(db, { documentId, body: 'Second' });
    const listed = listCommentsByDocument(db, documentId);
    expect(listed.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it('filters resolved comments by default', () => {
    const open = createDocumentComment(db, { documentId, body: 'Open' });
    const resolved = createDocumentComment(db, { documentId, body: 'Done' });
    updateDocumentComment(db, resolved.id, { resolved: true });

    expect(listCommentsByDocument(db, documentId).map((c) => c.id)).toEqual([open.id]);
    expect(listCommentsByDocument(db, documentId, { includeResolved: true })).toHaveLength(2);
  });

  it('lists comments by project via document join', () => {
    const otherProjectId = createProject(db, { name: 'Other' }).id;
    const otherDocId = createDocument(db, { projectId: otherProjectId, title: 'Other' }).id;
    const mine = createDocumentComment(db, { documentId, body: 'Mine' });
    createDocumentComment(db, { documentId: otherDocId, body: 'Theirs' });

    const listed = listCommentsByProject(db, projectId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(mine.id);
  });

  it('updates and deletes a comment', () => {
    const created = createDocumentComment(db, { documentId, body: 'Before' });
    const updated = updateDocumentComment(db, created.id, { body: 'After', resolved: true });
    expect(updated?.body).toBe('After');
    expect(updated?.resolved).toBe(true);

    expect(deleteDocumentComment(db, created.id)).toBe(true);
    expect(getDocumentComment(db, created.id)).toBeUndefined();
    expect(deleteDocumentComment(db, created.id)).toBe(false);
  });

  it('deletes comments by document and project', () => {
    const doc2 = createDocument(db, { projectId, title: 'Doc 2' }).id;
    createDocumentComment(db, { documentId, body: 'A' });
    createDocumentComment(db, { documentId: doc2, body: 'B' });

    expect(deleteCommentsByDocumentId(db, documentId)).toBe(1);
    expect(listCommentsByDocument(db, documentId, { includeResolved: true })).toHaveLength(0);
    expect(listCommentsByProject(db, projectId, { includeResolved: true })).toHaveLength(1);

    expect(deleteCommentsByProjectId(db, projectId)).toBe(1);
    expect(listCommentsByProject(db, projectId, { includeResolved: true })).toHaveLength(0);
  });
});
