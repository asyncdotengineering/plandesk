import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ORG_ID,
  createDb,
  createProjectInDefaultOrg as createProject,
  getSubmission,
  listTasks,
  migrate,
  upsertSubmission,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createTaskService } from './tasks.js';
import {
  createSyncService,
  InvalidTriageError,
  InvalidTriageInputError,
  SubmissionRetriageMismatchError,
} from './sync.js';

const remoteSubmission = {
  id: 'sub-remote-1',
  share_id: 'hosted-share-1',
  participant_name: 'Alex',
  title: 'Bug report',
  body: 'Something broke',
  severity: 'high',
  created_at: new Date('2026-01-15T12:00:00.000Z'),
  pulled_at: new Date('2026-01-15T12:01:00.000Z'),
};

describe('syncService', () => {
  let db: Db;
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    orgId = DEFAULT_ORG_ID;
    await db.$client.execute('DELETE FROM share_submissions');
    await db.$client.execute('DELETE FROM sync_state');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createService() {
    const taskService = createTaskService({ db, orgId });
    return createSyncService({ db, taskService, orgId });
  }

  async function seedSubmission(projectId: string) {
    await upsertSubmission(db, {
      id: remoteSubmission.id,
      projectId,
      hostedShareId: remoteSubmission.share_id,
      participantName: remoteSubmission.participant_name,
      title: remoteSubmission.title,
      body: remoteSubmission.body,
      severity: remoteSubmission.severity,
      createdAt: remoteSubmission.created_at,
      pulledAt: remoteSubmission.pulled_at,
    });
  }

  it('listTriage returns serialized pending submissions', async () => {
    const project = await createProject(db, { name: 'Triage' });
    const service = createService();
    await seedSubmission(project.id);

    const triage = await service.listTriage(project.id, 'pending');
    expect(triage).toHaveLength(1);
    expect(triage?.[0]).toMatchObject({
      id: 'sub-remote-1',
      project_id: project.id,
      participant_name: 'Alex',
      title: 'Bug report',
      status: 'pending',
    });
  });

  it('triage accept creates task and sets local accepted', async () => {
    const project = await createProject(db, { name: 'Accept' });
    const service = createService();
    await seedSubmission(project.id);

    const result = await service.triage('sub-remote-1', 'accept');

    expect(result.status).toBe('accepted');
    expect(result.linked_task_id).toBeTruthy();

    const tasks = await listTasks(db, project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.label).toBe('Bug report');
    expect(tasks[0]?.status).toBe('scope');
    expect(tasks[0]?.description).toContain('Something broke');
    expect(tasks[0]?.description).toContain('Reported by Alex (client) via Plan Desk');

    const local = await getSubmission(db, 'sub-remote-1');
    expect(local?.status).toBe('accepted');
    expect(local?.linkedTaskId).toBe(result.linked_task_id);
  });

  it('triage reject sets local rejected', async () => {
    const project = await createProject(db, { name: 'Reject' });
    const service = createService();
    await seedSubmission(project.id);

    const result = await service.triage('sub-remote-1', 'reject');

    expect(result.status).toBe('rejected');
    expect(result.linked_task_id).toBeNull();
    expect(await listTasks(db, project.id)).toHaveLength(0);
  });

  it('triage re-accept is idempotent and does not create a duplicate task', async () => {
    const project = await createProject(db, { name: 'Idempotent' });
    const service = createService();
    await seedSubmission(project.id);

    const first = await service.triage('sub-remote-1', 'accept');
    const second = await service.triage('sub-remote-1', 'accept');

    expect(second).toEqual(first);
    expect(await listTasks(db, project.id)).toHaveLength(1);
  });

  it('triage throws InvalidTriageError for unknown submission', async () => {
    const service = createService();
    await expect(service.triage('missing', 'accept')).rejects.toBeInstanceOf(InvalidTriageError);
  });

  it('triage accept-as-merge links an existing task without creating a new one', async () => {
    const project = await createProject(db, { name: 'Merge' });
    const existingTask = await createTask(db, { projectId: project.id, label: 'Existing task' });
    const service = createService();
    await seedSubmission(project.id);

    const result = await service.triage('sub-remote-1', 'accept', undefined, existingTask.id);

    expect(result.status).toBe('accepted');
    expect(result.linked_task_id).toBe(existingTask.id);

    const tasks = await listTasks(db, project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(existingTask.id);

    const local = await getSubmission(db, 'sub-remote-1');
    expect(local?.status).toBe('accepted');
    expect(local?.linkedTaskId).toBe(existingTask.id);
  });

  it('triage rejects when both as_task and link_task_id are provided', async () => {
    const project = await createProject(db, { name: 'Mutually exclusive' });
    const existingTask = await createTask(db, { projectId: project.id, label: 'Existing task' });
    const service = createService();
    await seedSubmission(project.id);

    await expect(
      service.triage('sub-remote-1', 'accept', { label: 'New task' }, existingTask.id),
    ).rejects.toBeInstanceOf(InvalidTriageInputError);

    expect(await listTasks(db, project.id)).toHaveLength(1);
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('pending');
  });

  it('triage rejects link_task_id for a task that does not exist', async () => {
    const project = await createProject(db, { name: 'Missing link target' });
    const service = createService();
    await seedSubmission(project.id);

    await expect(
      service.triage('sub-remote-1', 'accept', undefined, 'missing-task-id'),
    ).rejects.toBeInstanceOf(InvalidTriageInputError);

    expect(await listTasks(db, project.id)).toHaveLength(0);
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('pending');
  });

  it('triage rejects link_task_id for a task belonging to a different project', async () => {
    const project = await createProject(db, { name: 'Cross-project source' });
    const otherProject = await createProject(db, { name: 'Cross-project other' });
    const otherTask = await createTask(db, {
      projectId: otherProject.id,
      label: 'Other project task',
    });
    const service = createService();
    await seedSubmission(project.id);

    await expect(
      service.triage('sub-remote-1', 'accept', undefined, otherTask.id),
    ).rejects.toBeInstanceOf(InvalidTriageInputError);

    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('pending');
  });

  it('triage accept-as-merge re-run is idempotent and does not create an orphan task', async () => {
    const project = await createProject(db, { name: 'Merge idempotent' });
    const existingTask = await createTask(db, { projectId: project.id, label: 'Existing task' });
    const service = createService();
    await seedSubmission(project.id);

    const first = await service.triage('sub-remote-1', 'accept', undefined, existingTask.id);
    const second = await service.triage('sub-remote-1', 'accept', undefined, existingTask.id);

    expect(second).toEqual(first);
    expect(await listTasks(db, project.id)).toHaveLength(1);
  });

  it('triage accept-as-merge retry with a different link_task_id throws SubmissionRetriageMismatchError', async () => {
    const project = await createProject(db, { name: 'Merge mismatch' });
    const taskA = await createTask(db, { projectId: project.id, label: 'Task A' });
    const taskB = await createTask(db, { projectId: project.id, label: 'Task B' });
    const service = createService();
    await seedSubmission(project.id);

    const first = await service.triage('sub-remote-1', 'accept', undefined, taskA.id);
    expect(first.linked_task_id).toBe(taskA.id);

    await expect(
      service.triage('sub-remote-1', 'accept', undefined, taskB.id),
    ).rejects.toBeInstanceOf(SubmissionRetriageMismatchError);

    const stored = await getSubmission(db, 'sub-remote-1');
    expect(stored?.status).toBe('accepted');
    expect(stored?.linkedTaskId).toBe(taskA.id);
  });

  it('triage accept-as-merge retry with as_task throws SubmissionRetriageMismatchError', async () => {
    const project = await createProject(db, { name: 'Merge as-task mismatch' });
    const taskA = await createTask(db, { projectId: project.id, label: 'Task A' });
    const service = createService();
    await seedSubmission(project.id);

    const first = await service.triage('sub-remote-1', 'accept', undefined, taskA.id);
    expect(first.linked_task_id).toBe(taskA.id);

    await expect(
      service.triage('sub-remote-1', 'accept', { label: 'New task' }),
    ).rejects.toBeInstanceOf(SubmissionRetriageMismatchError);

    const stored = await getSubmission(db, 'sub-remote-1');
    expect(stored?.status).toBe('accepted');
    expect(stored?.linkedTaskId).toBe(taskA.id);
  });

  it('triage accept then reject throws SubmissionRetriageMismatchError', async () => {
    const project = await createProject(db, { name: 'Accept then reject' });
    const taskA = await createTask(db, { projectId: project.id, label: 'Task A' });
    const service = createService();
    await seedSubmission(project.id);

    await service.triage('sub-remote-1', 'accept', undefined, taskA.id);

    await expect(service.triage('sub-remote-1', 'reject')).rejects.toBeInstanceOf(
      SubmissionRetriageMismatchError,
    );

    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('accepted');
  });

  it('triage reject then accept throws SubmissionRetriageMismatchError', async () => {
    const project = await createProject(db, { name: 'Reject then accept' });
    const service = createService();
    await seedSubmission(project.id);

    await service.triage('sub-remote-1', 'reject');

    await expect(service.triage('sub-remote-1', 'accept')).rejects.toBeInstanceOf(
      SubmissionRetriageMismatchError,
    );

    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('rejected');
  });

  it('triage accept-as-merge retry with the same link_task_id stays idempotent', async () => {
    const project = await createProject(db, { name: 'Same link recovery' });
    const taskA = await createTask(db, { projectId: project.id, label: 'Task A' });
    const service = createService();
    await seedSubmission(project.id);

    const first = await service.triage('sub-remote-1', 'accept', undefined, taskA.id);
    const second = await service.triage('sub-remote-1', 'accept', undefined, taskA.id);

    expect(second).toEqual(first);
    expect((await getSubmission(db, 'sub-remote-1'))?.status).toBe('accepted');
    expect((await getSubmission(db, 'sub-remote-1'))?.linkedTaskId).toBe(taskA.id);
  });
});
