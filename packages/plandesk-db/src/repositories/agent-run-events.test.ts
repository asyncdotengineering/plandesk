import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createAgentRun } from './agent-runs.js';
import { createProject } from './projects.js';
import { createAgentRunEvent, listAgentRunEvents } from './agent-run-events.js';

describe('agent run events repository', () => {
  let db: Db;
  let runId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const projectId = (await createProject(db, { name: 'Events Project' })).id;
    runId = (await createAgentRun(db, { projectId })).id;
  });

  it('creates and lists events for a run', async () => {
    const first = await createAgentRunEvent(db, { runId, message: 'Starting' });
    const second = await createAgentRunEvent(db, { runId, message: 'Halfway' });
    const events = await listAgentRunEvents(db, runId);
    expect(events).toEqual([first, second]);
  });

  it('returns an empty list for a run with no events', async () => {
    expect(await listAgentRunEvents(db, runId)).toEqual([]);
  });
});
