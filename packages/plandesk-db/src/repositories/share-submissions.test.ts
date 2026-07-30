import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import {
  createProjectInDefaultOrg as createProject,
  createTaskWithDefaultGoal as createTask,
} from '../testing.js';
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
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('upserts a submission idempotently by primary key', async () => {
    const project = await createProject(db, { name: 'Pull' });
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const pulledAt = new Date('2026-01-02T00:00:00.000Z');

    const first = await upsertSubmission(db, {
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
    expect(await listSubmissions(db, project.id)).toHaveLength(1);

    const second = await upsertSubmission(db, {
      id: 'sub-1',
      projectId: project.id,
      hostedShareId: 'hosted-share-1',
      participantName: 'Changed',
      title: 'Changed',
      createdAt,
      pulledAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    expect(second).toBe(false);
    expect(await listSubmissions(db, project.id)).toHaveLength(1);
    expect((await getSubmission(db, 'sub-1'))?.participantName).toBe('Alex');
  });

  it('lists submissions optionally filtered by status', async () => {
    const project = await createProject(db, { name: 'Filter' });
    const now = new Date();

    await upsertSubmission(db, {
      id: 'sub-pending',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Alex',
      title: 'Pending',
      createdAt: now,
      pulledAt: now,
    });
    await upsertSubmission(db, {
      id: 'sub-accepted',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Blake',
      title: 'Accepted',
      createdAt: now,
      pulledAt: now,
    });
    await setSubmissionStatus(db, 'sub-accepted', { status: 'accepted' });

    expect(await listSubmissions(db, project.id)).toHaveLength(2);
    expect(await listSubmissions(db, project.id, 'pending')).toHaveLength(1);
    expect((await listSubmissions(db, project.id, 'pending'))[0]?.title).toBe('Pending');
  });

  it('setSubmissionStatus against a non-pending submission returns undefined and writes nothing', async () => {
    const project = await createProject(db, { name: 'CAS guard' });
    const taskA = await createTask(db, { projectId: project.id, label: 'Task A' });
    const taskB = await createTask(db, { projectId: project.id, label: 'Task B' });
    const now = new Date();
    await upsertSubmission(db, {
      id: 'sub-cas',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Alex',
      title: 'Already moved',
      createdAt: now,
      pulledAt: now,
    });

    const first = await setSubmissionStatus(db, 'sub-cas', {
      status: 'accepted',
      linkedTaskId: taskA.id,
    });
    expect(first?.status).toBe('accepted');
    expect(first?.linkedTaskId).toBe(taskA.id);

    const second = await setSubmissionStatus(db, 'sub-cas', {
      status: 'accepted',
      linkedTaskId: taskB.id,
    });
    expect(second).toBeUndefined();

    const stored = await getSubmission(db, 'sub-cas');
    expect(stored?.status).toBe('accepted');
    expect(stored?.linkedTaskId).toBe(taskA.id);
  });

  it('test:set_submission_status_race — concurrent setSubmissionStatus yields exactly one winner', async () => {
    const project = await createProject(db, { name: 'Status Race' });
    const taskA = await createTask(db, { projectId: project.id, label: 'Task A' });
    const taskB = await createTask(db, { projectId: project.id, label: 'Task B' });
    const now = new Date();
    await upsertSubmission(db, {
      id: 'sub-race',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Alex',
      title: 'Only one may triage',
      createdAt: now,
      pulledAt: now,
    });

    const [a, b] = await Promise.all([
      setSubmissionStatus(db, 'sub-race', { status: 'accepted', linkedTaskId: taskA.id }),
      setSubmissionStatus(db, 'sub-race', { status: 'accepted', linkedTaskId: taskB.id }),
    ]);

    const winners = [a, b].filter((row) => row !== undefined);
    const losers = [a, b].filter((row) => row === undefined);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect([taskA.id, taskB.id]).toContain(winners[0]?.linkedTaskId);

    const stored = await getSubmission(db, 'sub-race');
    expect(stored?.status).toBe('accepted');
    expect(stored?.linkedTaskId).toBe(winners[0]?.linkedTaskId);
  });

  it('stores and updates pull cursor per project', async () => {
    const project = await createProject(db, { name: 'Cursor' });
    expect(await getPullCursor(db, project.id)).toBeUndefined();

    await setPullCursor(db, project.id, '2026-01-01T00:00:00.000Z');
    expect(await getPullCursor(db, project.id)).toBe('2026-01-01T00:00:00.000Z');

    await setPullCursor(db, project.id, '2026-01-02T00:00:00.000Z');
    expect(await getPullCursor(db, project.id)).toBe('2026-01-02T00:00:00.000Z');
  });

  it('deletes submissions and sync state by project id', async () => {
    const project = await createProject(db, { name: 'Delete' });
    const now = new Date();
    await upsertSubmission(db, {
      id: 'sub-del',
      projectId: project.id,
      hostedShareId: 'share-1',
      participantName: 'Alex',
      title: 'Delete me',
      createdAt: now,
      pulledAt: now,
    });
    await setPullCursor(db, project.id, '2026-01-01T00:00:00.000Z');

    expect(await deleteShareSubmissionsByProjectId(db, project.id)).toBe(1);
    expect(await deleteSyncStateByProjectId(db, project.id)).toBe(1);
    expect(await listSubmissions(db, project.id)).toHaveLength(0);
    expect(await getPullCursor(db, project.id)).toBeUndefined();
  });
});
