import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentRun, createDb, createProject, migrate , type Db} from '@plandesk/db';
import {
  createEventBus,
  type AgentRunCompletedEvent,
  type AgentRunProgressEvent,
  type AgentRunStartedEvent,
} from '../events.js';
import { createAgentRunService, InvalidAgentRunError } from './agent-runs.js';

describe('agentRunService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createAgentRunService({ db, eventBus });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM agent_run_events');
    await db.$client.execute('DELETE FROM agent_runs');
    await db.$client.execute('DELETE FROM projects');
    projectId = (await createProject(db, { name: 'Agent' })).id;
  });

  it('starts a run and emits agent_run_started', async () => {
    const service = createService();
    const started: AgentRunStartedEvent[] = [];
    eventBus.subscribe((event) => {
      if (event.type === 'agent_run_started') {
        started.push(event);
      }
    });

    const run = await service.start(projectId, 'Worker');
    expect(run).toMatchObject({
      project_id: projectId,
      status: 'running',
      label: 'Worker',
    });
    expect(run).toBeDefined();
    if (!run) {
      throw new Error('expected run');
    }
    expect(started).toEqual([{ type: 'agent_run_started', runId: run.id, projectId }]);
  });

  it('records progress and emits agent_run_progress', async () => {
    const service = createService();
    const run = await service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }
    const progress: AgentRunProgressEvent[] = [];
    eventBus.subscribe((event) => {
      if (event.type === 'agent_run_progress') {
        progress.push(event);
      }
    });

    const event = await service.recordProgress(run.id, 'Halfway');
    expect(event).toMatchObject({ run_id: run.id, message: 'Halfway' });
    expect(progress).toEqual([{ type: 'agent_run_progress', runId: run.id, projectId }]);
  });

  it('completes a run and emits agent_run_completed', async () => {
    const service = createService();
    const run = await service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }
    const completed: AgentRunCompletedEvent[] = [];
    eventBus.subscribe((event) => {
      if (event.type === 'agent_run_completed') {
        completed.push(event);
      }
    });

    const finished = await service.complete(run.id, 'completed');
    expect(finished).toMatchObject({ status: 'completed' });
    expect(finished?.completed_at).toBeTruthy();
    expect(completed).toEqual([{ type: 'agent_run_completed', runId: run.id, projectId }]);
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
