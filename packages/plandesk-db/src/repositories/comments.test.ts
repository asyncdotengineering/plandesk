import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createDocument } from './documents.js';
import { createProject } from './projects.js';
import {
  createComment,
  deleteComment,
  deleteCommentsByProjectId,
  deleteCommentsByTarget,
  getComment,
  listCommentsByProject,
  listCommentsByTarget,
  updateComment,
} from './comments.js';

describe('comments repository', () => {
  const db = createDb(':memory:');
  let projectId = '';
  let documentId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM comments');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Comments' }).id;
    documentId = createDocument(db, { projectId, title: 'Doc' }).id;
  });

  it('creates and retrieves a comment', () => {
    const created = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Needs revision',
      passage: 'Section 2',
    });
    const fetched = getComment(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.body).toBe('Needs revision');
    expect(fetched?.passage).toBe('Section 2');
    expect(fetched?.resolved).toBe(false);
  });

  it('lists comments by target ordered by created_at asc', () => {
    const first = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'First',
    });
    const second = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Second',
    });
    const listed = listCommentsByTarget(db, 'document', documentId);
    expect(listed.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it('filters resolved comments by default', () => {
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
    updateComment(db, resolved.id, { resolved: true });

    expect(listCommentsByTarget(db, 'document', documentId).map((c) => c.id)).toEqual([open.id]);
    expect(
      listCommentsByTarget(db, 'document', documentId, { includeResolved: true }),
    ).toHaveLength(2);
  });

  it('lists comments by project', () => {
    const otherProjectId = createProject(db, { name: 'Other' }).id;
    const otherDocId = createDocument(db, { projectId: otherProjectId, title: 'Other' }).id;
    const mine = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Mine',
    });
    createComment(db, {
      projectId: otherProjectId,
      targetType: 'document',
      targetId: otherDocId,
      body: 'Theirs',
    });

    const listed = listCommentsByProject(db, projectId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(mine.id);
  });

  it('updates and deletes a comment', () => {
    const created = createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Before',
    });
    const updated = updateComment(db, created.id, { body: 'After', resolved: true });
    expect(updated?.body).toBe('After');
    expect(updated?.resolved).toBe(true);

    expect(deleteComment(db, created.id)).toBe(true);
    expect(getComment(db, created.id)).toBeUndefined();
    expect(deleteComment(db, created.id)).toBe(false);
  });

  it('deletes comments by target and project', () => {
    const doc2 = createDocument(db, { projectId, title: 'Doc 2' }).id;
    createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'A',
    });
    createComment(db, {
      projectId,
      targetType: 'document',
      targetId: doc2,
      body: 'B',
    });

    expect(deleteCommentsByTarget(db, 'document', documentId)).toBe(1);
    expect(
      listCommentsByTarget(db, 'document', documentId, { includeResolved: true }),
    ).toHaveLength(0);
    expect(listCommentsByProject(db, projectId, { includeResolved: true })).toHaveLength(1);

    expect(deleteCommentsByProjectId(db, projectId)).toBe(1);
    expect(listCommentsByProject(db, projectId, { includeResolved: true })).toHaveLength(0);
  });
});
