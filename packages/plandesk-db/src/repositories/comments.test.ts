import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createDocument } from './documents.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
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
  let db: Db;
  let projectId = '';
  let documentId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Comments' })).id;
    documentId = (await createDocument(db, { projectId, title: 'Doc' })).id;
  });

  it('creates and retrieves a comment', async () => {
    const created = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Needs revision',
      passage: 'Section 2',
    });
    const fetched = await getComment(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.body).toBe('Needs revision');
    expect(fetched?.passage).toBe('Section 2');
    expect(fetched?.resolved).toBe(false);
  });

  it('round-trips an artifact annotation with a W3C anchor selector', async () => {
    const anchor = JSON.stringify({
      type: 'TextQuoteSelector',
      exact: 'network-dead CSP',
      prefix: 'sandboxed iframe with a ',
      suffix: ' so annotation happens',
      start: 1200,
      end: 1216,
    });
    const created = await createComment(db, {
      projectId,
      targetType: 'artifact',
      targetId: 'sha256:abc123::report.md',
      body: 'Confirm the CSP blocks connect-src',
      passage: 'network-dead CSP',
      anchor,
    });

    const fetched = await getComment(db, created.id);
    expect(fetched?.targetType).toBe('artifact');
    expect(fetched?.anchor).toBe(anchor);

    const listed = await listCommentsByTarget(db, 'artifact', 'sha256:abc123::report.md');
    expect(listed.map((c) => c.id)).toEqual([created.id]);
    expect(JSON.parse(listed[0]?.anchor ?? 'null')).toMatchObject({ exact: 'network-dead CSP' });
  });

  it('defaults anchor to null for a plain comment', async () => {
    const created = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'No anchor here',
    });
    expect((await getComment(db, created.id))?.anchor).toBeNull();
  });

  it('lists comments by target ordered by created_at asc', async () => {
    const first = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'First',
    });
    const second = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Second',
    });
    const listed = await listCommentsByTarget(db, 'document', documentId);
    expect(listed.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it('filters resolved comments by default', async () => {
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
    await updateComment(db, resolved.id, { resolved: true });

    expect((await listCommentsByTarget(db, 'document', documentId)).map((c) => c.id)).toEqual([
      open.id,
    ]);
    expect(
      await listCommentsByTarget(db, 'document', documentId, { includeResolved: true }),
    ).toHaveLength(2);
  });

  it('lists comments by project', async () => {
    const otherProjectId = (await createProject(db, { name: 'Other' })).id;
    const otherDocId = (await createDocument(db, { projectId: otherProjectId, title: 'Other' })).id;
    const mine = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Mine',
    });
    await createComment(db, {
      projectId: otherProjectId,
      targetType: 'document',
      targetId: otherDocId,
      body: 'Theirs',
    });

    const listed = await listCommentsByProject(db, projectId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(mine.id);
  });

  it('updates and deletes a comment', async () => {
    const created = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'Before',
    });
    const updated = await updateComment(db, created.id, { body: 'After', resolved: true });
    expect(updated?.body).toBe('After');
    expect(updated?.resolved).toBe(true);

    expect(await deleteComment(db, created.id)).toBe(true);
    expect(await getComment(db, created.id)).toBeUndefined();
    expect(await deleteComment(db, created.id)).toBe(false);
  });

  it('deletes comments by target and project', async () => {
    const doc2 = (await createDocument(db, { projectId, title: 'Doc 2' })).id;
    await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: documentId,
      body: 'A',
    });
    await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: doc2,
      body: 'B',
    });

    expect(await deleteCommentsByTarget(db, 'document', documentId)).toBe(1);
    expect(
      await listCommentsByTarget(db, 'document', documentId, { includeResolved: true }),
    ).toHaveLength(0);
    expect(await listCommentsByProject(db, projectId, { includeResolved: true })).toHaveLength(1);

    expect(await deleteCommentsByProjectId(db, projectId)).toBe(1);
    expect(await listCommentsByProject(db, projectId, { includeResolved: true })).toHaveLength(0);
  });
});
