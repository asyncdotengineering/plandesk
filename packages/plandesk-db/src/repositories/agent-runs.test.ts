import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createAgentRun, getAgentRun, listAgentRuns, updateAgentRunStatus } from './agent-runs.js';

describe('agent runs repository', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM agent_run_events');
    db.$client.exec('DELETE FROM agent_runs');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Agent Project' }).id;
  });

  it('creates a run with running status', () => {
    const run = createAgentRun(db, { projectId, label: 'Sprint agent' });
    expect(run.status).toBe('running');
    expect(run.label).toBe('Sprint agent');
    expect(run.completedAt).toBeNull();
    expect(getAgentRun(db, run.id)).toEqual(run);
  });

  it('returns undefined for a missing run', () => {
    expect(getAgentRun(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists runs for a project', () => {
    const first = createAgentRun(db, { projectId, label: 'First' });
    const second = createAgentRun(db, { projectId, label: 'Second' });
    expect(listAgentRuns(db, projectId)).toEqual([first, second]);
    expect(listAgentRuns(db, '00000000-0000-4000-8000-000000009999')).toEqual([]);
  });

  it('updates status and completed_at', () => {
    const run = createAgentRun(db, { projectId });
    const completedAt = new Date('2026-06-07T12:00:00.000Z');
    const updated = updateAgentRunStatus(db, run.id, {
      status: 'completed',
      completedAt,
    });
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt?.toISOString()).toBe(completedAt.toISOString());
  });
});
