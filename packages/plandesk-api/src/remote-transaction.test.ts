import { createDb, createProjectInDefaultOrg as createProject, migrate } from '@plandesk/db';
import { findSqld, startSqld } from '@plandesk/db/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { localOwner } from './principal.js';
import { createApp } from './server.js';
import { createServices } from './services/index.js';

const sqld = findSqld();
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

// Hosted deployments run every service write on a remote libSQL database, where
// each statement outside an interactive transaction is its own stream.
describe.skipIf(sqld === undefined)('transactional writes against sqld over HTTP', () => {
  it('creates a goal and a task through the API and reads them back', async () => {
    const server = await startSqld(sqld ?? '');
    stops.push(server.stop);
    const db = await createDb(server.url);
    await migrate(db);
    const project = await createProject(db, { name: 'Remote' });
    const app = createApp({
      db,
      services: createServices({ db, principal: localOwner(project.orgId) }),
    });
    const json = { 'content-type': 'application/json' };

    const goalRes = await app.request(`/api/v1/projects/${project.id}/goals`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ objective: 'Ship hosted writes' }),
    });
    expect(goalRes.status).toBe(201);
    const goal = (await goalRes.json()) as { id: string };

    const taskRes = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ label: 'Write it', goal_id: goal.id }),
    });
    expect(taskRes.status).toBe(201);

    const goals = (await (await app.request(`/api/v1/projects/${project.id}/goals`)).json()) as {
      id: string;
    }[];
    expect(goals.map((g) => g.id)).toContain(goal.id);
    const tasks = (await (await app.request(`/api/v1/projects/${project.id}/tasks`)).json()) as {
      label: string;
      goal_id: string | null;
    }[];
    expect(tasks.map((t) => [t.label, t.goal_id])).toEqual([['Write it', goal.id]]);
  });
});
