import { describe, expect, it } from 'vitest';
import { createDb, createGoal, createProject, migrate } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createApp } from '../server.js';
import { createEventBus } from '../events.js';
import { createServices } from '../services/index.js';
import { parseJson } from '../test-helpers.js';

function createTestApp() {
  const db = createDb(':memory:');
  migrate(db);
  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const app = createApp({ db, eventBus, services });
  return { app, db, services };
}

describe('goals routes', () => {
  it('POST /projects/:id/goals creates a goal', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Goals' });

    const res = await app.request(`/api/v1/projects/${project.id}/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objective: 'Ship S2',
        verification_surface: JSON.stringify({ kind: 'gate_command', command: 'pnpm validate' }),
      }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<{ objective: string; verification_surface: string }>(res);
    expect(body.objective).toBe('Ship S2');
    expect(body.verification_surface).toContain('gate_command');
  });

  it('GET /projects/:id/goals lists goals and 404s missing project', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'List' });
    createGoal(db, { projectId: project.id, objective: 'One' });

    const res = await app.request(`/api/v1/projects/${project.id}/goals`);
    expect(res.status).toBe(200);
    const body = await parseJson<Array<{ objective: string }>>(res);
    expect(body).toHaveLength(1);

    const missing = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/goals',
    );
    expect(missing.status).toBe(404);
  });

  it('GET /goals/:id returns goal with cycle_tasks', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Detail' });
    const goal = createGoal(db, { projectId: project.id, objective: 'Detail goal' });
    const task = createTask(db, { projectId: project.id, goalId: goal.id, label: 'Child' });

    const res = await app.request(`/api/v1/goals/${goal.id}`);
    expect(res.status).toBe(200);
    const body = await parseJson<{ objective: string; cycle_tasks: Array<{ id: string }> }>(res);
    expect(body.objective).toBe('Detail goal');
    expect(body.cycle_tasks.map((row) => row.id)).toEqual([task.id]);
  });

  it('PATCH /goals/:id updates contract fields', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Patch' });
    const goal = createGoal(db, { projectId: project.id, objective: 'Before' });

    const res = await app.request(`/api/v1/goals/${goal.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objective: 'After', budget: '1d' }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<{ objective: string; budget: string }>(res);
    expect(body).toMatchObject({ objective: 'After', budget: '1d' });
  });

  it('lifecycle routes enforce transition guards and completion blocking', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Lifecycle' });
    const goal = createGoal(db, {
      projectId: project.id,
      objective: 'Lifecycle',
      status: 'active',
    });
    const open = createTask(db, {
      projectId: project.id,
      goalId: goal.id,
      label: 'Open',
      status: 'todo',
    });

    const pauseRes = await app.request(`/api/v1/goals/${goal.id}/pause`, { method: 'POST' });
    expect(pauseRes.status).toBe(200);
    expect((await parseJson<{ status: string }>(pauseRes)).status).toBe('paused');

    const pauseAgain = await app.request(`/api/v1/goals/${goal.id}/pause`, { method: 'POST' });
    expect(pauseAgain.status).toBe(400);

    const resumeRes = await app.request(`/api/v1/goals/${goal.id}/resume`, { method: 'POST' });
    expect(resumeRes.status).toBe(200);

    const blocked = await app.request(`/api/v1/goals/${goal.id}/complete`, { method: 'POST' });
    expect(blocked.status).toBe(400);
    const blockedBody = await parseJson<{ error: string; incomplete_task_ids: string[] }>(blocked);
    expect(blockedBody.error).toBe('blocked_by_incomplete_tasks');
    expect(blockedBody.incomplete_task_ids).toEqual([open.id]);

    db.$client.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', open.id);
    const completeRes = await app.request(`/api/v1/goals/${goal.id}/complete`, { method: 'POST' });
    expect(completeRes.status).toBe(200);
    expect((await parseJson<{ status: string }>(completeRes)).status).toBe('complete');
  });

  it('POST /goals/:id/complete requires evidence when verification_surface is set', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Evidence' });
    const goal = createGoal(db, {
      projectId: project.id,
      objective: 'Gated',
      status: 'active',
      verificationSurface: JSON.stringify({ kind: 'gate_command', command: 'pnpm test' }),
    });
    const task = createTask(db, {
      projectId: project.id,
      goalId: goal.id,
      label: 'Done',
      status: 'done',
    });
    expect(task.id).toBeTruthy();

    const missing = await app.request(`/api/v1/goals/${goal.id}/complete`, { method: 'POST' });
    expect(missing.status).toBe(400);
    expect((await parseJson<{ error: string }>(missing)).error).toBe('verification_required');

    const red = await app.request(`/api/v1/goals/${goal.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence: { kind: 'gate_command', exit_code: 1 } }),
    });
    expect(red.status).toBe(200);
    const redBody = await parseJson<{ status: string; last_verification: { green: boolean } }>(red);
    expect(redBody.status).toBe('blocked');
    expect(redBody.last_verification.green).toBe(false);

    db.$client.prepare('UPDATE goals SET status = ? WHERE id = ?').run('active', goal.id);
    for (const row of db.$client
      .prepare('SELECT id FROM tasks WHERE goal_id = ? AND status = ?')
      .all(goal.id, 'scope') as Array<{ id: string }>) {
      db.$client.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', row.id);
    }
    const green = await app.request(`/api/v1/goals/${goal.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence: { kind: 'gate_command', exit_code: 0 } }),
    });
    expect(green.status).toBe(200);
    expect((await parseJson<{ status: string }>(green)).status).toBe('complete');
  });
});
