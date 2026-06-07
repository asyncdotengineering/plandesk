import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createAgentRun } from './agent-runs.js';
import { createProject } from './projects.js';
import { createAgentRunEvent, listAgentRunEvents } from './agent-run-events.js';

describe('agent run events repository', () => {
  const db = createDb(':memory:');
  let runId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM agent_run_events');
    db.$client.exec('DELETE FROM agent_runs');
    db.$client.exec('DELETE FROM projects');
    const projectId = createProject(db, { name: 'Events Project' }).id;
    runId = createAgentRun(db, { projectId }).id;
  });

  it('creates and lists events for a run', () => {
    const first = createAgentRunEvent(db, { runId, message: 'Starting' });
    const second = createAgentRunEvent(db, { runId, message: 'Halfway' });
    const events = listAgentRunEvents(db, runId);
    expect(events).toEqual([first, second]);
  });

  it('returns an empty list for a run with no events', () => {
    expect(listAgentRunEvents(db, runId)).toEqual([]);
  });
});
