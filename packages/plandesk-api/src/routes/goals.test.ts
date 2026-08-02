import { describe, expect, it } from 'vitest';
import { createDb, createGoal, createProjectInDefaultOrg as createProject, migrate } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createApp } from '../server.js';
import { createServices } from '../services/index.js';
import { parseJson, readStringCell } from '../test-helpers.js';

async function createTestApp() {
  const db = await createDb(':memory:');
  await migrate(db);
  const seed = await createProject(db, { name: '__seed__' });
  const services = createServices({ db, orgId: seed.orgId });
  const app = createApp({ db, services });
  return { app, db, services };
}

describe('goals routes', () => {
  it('POST /projects/:id/goals creates a goal', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Goals' });

    const res = await app.request(`/api/v1/projects/${project.id}/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objective: 'Ship S2',
        verification_surface: JSON.stringify({ kind: 'gate_command', command: 'pnpm validate' }),
      }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<{
      objective: string;
      verification_surface: string;
      warnings: string[];
    }>(res);
    expect(body.objective).toBe('Ship S2');
    expect(body.verification_surface).toContain('gate_command');
    expect(body.warnings).toEqual([]);
  });

  it('checklist completion reports unknown evidence and returns stable item ids', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Checklist route' });
    const surface = {
      kind: 'acceptance_checklist',
      items: [{ criterion: 'Tests pass' }, { criterion: 'Lint clean' }],
    };

    const createRes = await app.request(`/api/v1/projects/${project.id}/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objective: 'Checklist route goal', verification_surface: JSON.stringify(surface) }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{ id: string; verification_surface: string }>(createRes);
    const createdSurface = JSON.parse(created.verification_surface) as {
      items: Array<{ id: string; criterion: string }>;
    };
    expect(createdSurface.items.map((item) => item.id)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);

    await createTask(db, { projectId: project.id, goalId: created.id, label: 'Done', status: 'done' });
    const completeRes = await app.request(`/api/v1/goals/${created.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence: { kind: 'acceptance_checklist', checked: ['unknown-id'] } }),
    });
    expect(completeRes.status).toBe(400);
    expect(await parseJson(completeRes)).toEqual({
      error: 'invalid_argument',
      unmatched: ['unknown-id'],
      unmet: ['Tests pass', 'Lint clean'],
    });
  });

  it('goal writes return stored contract fields and warn for a null verification surface', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Warnings' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objective: 'Unverified goal',
        constraints: 'backend only',
        boundaries: 'no migrations',
        iteration_policy: 'one pass',
        stop_condition: 'green',
        budget: '2h',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{
      id: string;
      objective: string;
      verification_surface: string | null;
      constraints: string | null;
      boundaries: string | null;
      iteration_policy: string | null;
      stop_condition: string | null;
      budget: string | null;
      warnings: string[];
    }>(createRes);
    expect(created).toMatchObject({
      objective: 'Unverified goal',
      verification_surface: null,
      constraints: 'backend only',
      boundaries: 'no migrations',
      iteration_policy: 'one pass',
      stop_condition: 'green',
      budget: '2h',
    });
    expect(created.warnings).toEqual(['verification_surface is null']);

    const getRes = await app.request(`/api/v1/goals/${created.id}`);
    const fetched = await parseJson<typeof created>(getRes);
    expect(fetched).toMatchObject({
      id: created.id,
      objective: created.objective,
      verification_surface: created.verification_surface,
      constraints: created.constraints,
      boundaries: created.boundaries,
      iteration_policy: created.iteration_policy,
      stop_condition: created.stop_condition,
      budget: created.budget,
    });

    const badRes = await app.request(`/api/v1/projects/${project.id}/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objective: 'Rejected', verification_surface: '{bad json' }),
    });
    expect(badRes.status).toBe(400);
    const goalsRes = await app.request(`/api/v1/projects/${project.id}/goals`);
    const goals = await parseJson<Array<{ objective: string }>>(goalsRes);
    expect(goals.some((goal) => goal.objective === 'Rejected')).toBe(false);
  });

  it('GET /projects/:id/goals lists goals and 404s missing project', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'List' });
    await createGoal(db, { projectId: project.id, objective: 'One' });

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
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Detail' });
    const goal = await createGoal(db, { projectId: project.id, objective: 'Detail goal' });
    const task = await createTask(db, { projectId: project.id, goalId: goal.id, label: 'Child' });

    const res = await app.request(`/api/v1/goals/${goal.id}`);
    expect(res.status).toBe(200);
    const body = await parseJson<{ objective: string; cycle_tasks: Array<{ id: string }> }>(res);
    expect(body.objective).toBe('Detail goal');
    expect(body.cycle_tasks.map((row) => row.id)).toEqual([task.id]);
  });

  it('PATCH /goals/:id updates contract fields', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Patch' });
    const goal = await createGoal(db, { projectId: project.id, objective: 'Before' });

    const res = await app.request(`/api/v1/goals/${goal.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objective: 'After', budget: '1d' }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<{ objective: string; budget: string; warnings: string[] }>(res);
    expect(body).toMatchObject({ objective: 'After', budget: '1d' });
    expect(body.warnings).toEqual(['verification_surface is null']);
  });

  it('lifecycle routes enforce transition guards and completion blocking', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Lifecycle' });
    const goal = await createGoal(db, {
      projectId: project.id,
      objective: 'Lifecycle',
      status: 'active',
    });
    const open = await createTask(db, {
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

    await db.$client.execute({ sql: 'UPDATE tasks SET status = ? WHERE id = ?', args: ['done', open.id] });
    const completeRes = await app.request(`/api/v1/goals/${goal.id}/complete`, { method: 'POST' });
    expect(completeRes.status).toBe(200);
    expect((await parseJson<{ status: string }>(completeRes)).status).toBe('complete');
  });

  it('POST /goals/:id/complete requires evidence when verification_surface is set', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Evidence' });
    const goal = await createGoal(db, {
      projectId: project.id,
      objective: 'Gated',
      status: 'active',
      verificationSurface: JSON.stringify({ kind: 'gate_command', command: 'pnpm test' }),
    });
    const task = await createTask(db, {
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

    await db.$client.execute({ sql: 'UPDATE goals SET status = ? WHERE id = ?', args: ['active', goal.id] });
    for (const row of (
      await db.$client.execute({
        sql: 'SELECT id FROM tasks WHERE goal_id = ? AND status = ?',
        args: [goal.id, 'scope'],
      })
    ).rows) {
      await db.$client.execute({
        sql: 'UPDATE tasks SET status = ? WHERE id = ?',
        args: ['done', readStringCell(row.id, 'tasks.id')],
      });
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
