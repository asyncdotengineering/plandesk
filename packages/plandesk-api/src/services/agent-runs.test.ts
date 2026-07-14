import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentRun, createDb, createProjectInDefaultOrg as createProject, migrate, type Db } from '@plandesk/db';
import { createAgentRunService, InvalidAgentRunError } from './agent-runs.js';

describe('agentRunService', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Agent' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function createService() {
    return createAgentRunService({ db, orgId });
  }

  it('starts a run', async () => {
    const service = createService();

    const run = await service.start(projectId, 'Worker');
    expect(run).toMatchObject({
      project_id: projectId,
      status: 'running',
      label: 'Worker',
    });
    expect(run).toBeDefined();
  });

  it('records progress', async () => {
    const service = createService();
    const run = await service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }

    const event = await service.recordProgress(run.id, 'Halfway');
    expect(event).toMatchObject({ run_id: run.id, message: 'Halfway' });
  });

  it('completes a run', async () => {
    const service = createService();
    const run = await service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }

    const finished = await service.complete(run.id, 'completed');
    expect(finished).toMatchObject({ status: 'completed' });
    expect(finished?.completed_at).toBeTruthy();
  });

  it('rejects progress on a completed run', async () => {
    const service = createService();
    const run = await service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }
    await service.complete(run.id, 'completed');
    await expect(service.recordProgress(run.id, 'Late')).rejects.toThrow(InvalidAgentRunError);
  });

  it('lists runs with events newest-first', async () => {
    const service = createService();
    const olderRun = await createAgentRun(db, {
      projectId,
      label: 'Older',
      startedAt: new Date('2026-06-08T10:00:00.000Z'),
    });
    const newerRun = await createAgentRun(db, {
      projectId,
      label: 'Newer',
      startedAt: new Date('2026-06-08T11:00:00.000Z'),
    });
    await service.recordProgress(newerRun.id, 'Step one');
    await service.complete(olderRun.id, 'failed');

    const listed = await service.listForProject(projectId);
    expect(listed).toHaveLength(2);
    expect(listed?.[0]?.label).toBe('Newer');
    expect(listed?.[0]?.events).toEqual([expect.objectContaining({ message: 'Step one' })]);
    expect(listed?.[0]?.events[0]).not.toHaveProperty('run_id');
    expect(listed?.[1]?.label).toBe('Older');
    expect(listed?.[1]?.status).toBe('failed');
  });

  it('returns undefined for a missing project', async () => {
    const service = createService();
    expect(await service.listForProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });
});
