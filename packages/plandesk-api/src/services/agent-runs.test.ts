import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createProject, migrate } from '@plandesk/db';
import {
  createEventBus,
  type AgentRunCompletedEvent,
  type AgentRunProgressEvent,
  type AgentRunStartedEvent,
} from '../events.js';
import { createAgentRunService, InvalidAgentRunError } from './agent-runs.js';

describe('agentRunService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createAgentRunService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM agent_run_events');
    db.$client.exec('DELETE FROM agent_runs');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Agent' }).id;
  });

  it('starts a run and emits agent_run_started', () => {
    const service = createService();
    const started: AgentRunStartedEvent[] = [];
    eventBus.subscribe((event) => {
      if (event.type === 'agent_run_started') {
        started.push(event);
      }
    });

    const run = service.start(projectId, 'Worker');
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

  it('records progress and emits agent_run_progress', () => {
    const service = createService();
    const run = service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }
    const progress: AgentRunProgressEvent[] = [];
    eventBus.subscribe((event) => {
      if (event.type === 'agent_run_progress') {
        progress.push(event);
      }
    });

    const event = service.recordProgress(run.id, 'Halfway');
    expect(event).toMatchObject({ run_id: run.id, message: 'Halfway' });
    expect(progress).toEqual([{ type: 'agent_run_progress', runId: run.id, projectId }]);
  });

  it('completes a run and emits agent_run_completed', () => {
    const service = createService();
    const run = service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }
    const completed: AgentRunCompletedEvent[] = [];
    eventBus.subscribe((event) => {
      if (event.type === 'agent_run_completed') {
        completed.push(event);
      }
    });

    const finished = service.complete(run.id, 'completed');
    expect(finished).toMatchObject({ status: 'completed' });
    expect(finished?.completed_at).toBeTruthy();
    expect(completed).toEqual([{ type: 'agent_run_completed', runId: run.id, projectId }]);
  });

  it('rejects progress on a completed run', () => {
    const service = createService();
    const run = service.start(projectId);
    if (!run) {
      throw new Error('expected run');
    }
    service.complete(run.id, 'completed');
    expect(() => service.recordProgress(run.id, 'Late')).toThrow(InvalidAgentRunError);
  });
});
