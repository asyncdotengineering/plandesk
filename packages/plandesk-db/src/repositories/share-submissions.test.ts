import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import {
  deleteShareSubmissionsByProjectId,
  deleteSyncStateByProjectId,
  getPullCursor,
  getSubmission,
  listSubmissions,
  setPullCursor,
  setSubmissionStatus,
  upsertSubmission,
} from './share-submissions.js';

describe('share-submissions repository', () => {
  const db = createDb(':memory:');

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM share_submissions');
    db.$client.exec('DELETE FROM sync_state');
    db.$client.exec('DELETE FROM projects');
  });

  it('upserts a submission idempotently by primary key', () => {
    const project = createProject(db, { name: 'Pull' });
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const pulledAt = new Date('2026-01-02T00:00:00.000Z');

    const first = upsertSubmission(db, {
      id: 'sub-1',
      projectId: project.id,
      hostedShareId: 'hosted-share-1',
      participantName: 'Alex',
      title: 'Bug',
      body: 'Details',
      severity: 'high',
      taskRef: 'task-1',
      createdAt,
      pulledAt,
    });
    expect(first).toBe(true);
    expect(listSubmissions(db, project.id)).toHaveLength(1);

    const second = upsertSubmission(db, {
      id: 'sub-1',
      projectId: project.id,
      hostedShareId: 'hosted-share-1',
      participantName: 'Changed',
      title: 'Changed',
      createdAt,
      pulledAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    expect(second).toBe(false);
    expect(listSubmissions(db, project.id)).toHaveLength(1);
    expect(getSubmission(db, 'sub-1')?.participantName).toBe('Alex');
  });

  it('lists submissions optionally filtered by status', () => {
    const project = createProject(db, { name: 'Filter' });
    const now = new Date();

    upsertSubmission(db, {
      id: 'sub-pending',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Alex',
      title: 'Pending',
      createdAt: now,
      pulledAt: now,
    });
    upsertSubmission(db, {
      id: 'sub-accepted',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Blake',
      title: 'Accepted',
      createdAt: now,
      pulledAt: now,
    });
    setSubmissionStatus(db, 'sub-accepted', { status: 'accepted' });

    expect(listSubmissions(db, project.id)).toHaveLength(2);
    expect(listSubmissions(db, project.id, 'pending')).toHaveLength(1);
    expect(listSubmissions(db, project.id, 'pending')[0]?.title).toBe('Pending');
  });

  it('stores and updates pull cursor per project', () => {
    const project = createProject(db, { name: 'Cursor' });
    expect(getPullCursor(db, project.id)).toBeUndefined();

    setPullCursor(db, project.id, '2026-01-01T00:00:00.000Z');
    expect(getPullCursor(db, project.id)).toBe('2026-01-01T00:00:00.000Z');

    setPullCursor(db, project.id, '2026-01-02T00:00:00.000Z');
    expect(getPullCursor(db, project.id)).toBe('2026-01-02T00:00:00.000Z');
  });

  it('deletes submissions and sync state by project id', () => {
    const project = createProject(db, { name: 'Delete' });
    const now = new Date();
    upsertSubmission(db, {
      id: 'sub-del',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Alex',
      title: 'Delete me',
      createdAt: now,
      pulledAt: now,
    });
    setPullCursor(db, project.id, '2026-01-01T00:00:00.000Z');

    expect(deleteShareSubmissionsByProjectId(db, project.id)).toBe(1);
    expect(deleteSyncStateByProjectId(db, project.id)).toBe(1);
    expect(listSubmissions(db, project.id)).toHaveLength(0);
    expect(getPullCursor(db, project.id)).toBeUndefined();
  });
});
