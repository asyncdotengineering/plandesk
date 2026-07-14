import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createAgentRun, getAgentRun, listAgentRuns, updateAgentRunStatus } from './agent-runs.js';

describe('agent runs repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Agent Project' })).id;
  });

  it('creates a run with running status', async () => {
    const run = await createAgentRun(db, { projectId, label: 'Sprint agent' });
    expect(run.status).toBe('running');
    expect(run.label).toBe('Sprint agent');
    expect(run.completedAt).toBeNull();
    expect(await getAgentRun(db, run.id)).toEqual(run);
  });

  it('returns undefined for a missing run', async () => {
    expect(await getAgentRun(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists runs for a project', async () => {
    const first = await createAgentRun(db, { projectId, label: 'First' });
    const second = await createAgentRun(db, { projectId, label: 'Second' });
    expect(await listAgentRuns(db, projectId)).toEqual([first, second]);
    expect(await listAgentRuns(db, '00000000-0000-4000-8000-000000009999')).toEqual([]);
  });

  it('updates status and completed_at', async () => {
    const run = await createAgentRun(db, { projectId });
    const completedAt = new Date('2026-06-07T12:00:00.000Z');
    const updated = await updateAgentRunStatus(db, run.id, {
      status: 'completed',
      completedAt,
    });
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt?.toISOString()).toBe(completedAt.toISOString());
  });
});
