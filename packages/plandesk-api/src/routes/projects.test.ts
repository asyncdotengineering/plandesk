import { describe, expect, it } from 'vitest';
import {
  createEdge,
  createGoal,
  createProjectInDefaultOrg as createProject,
  getTask,
  listEdges,
  setProjectCurrentGoalId,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import {
  createTestApp,
  parseJson,
  type ProjectDetailResponse,
  type ProjectResponse,
  type TaskResponse,
} from '../test-helpers.js';

describe('projects routes', () => {
  it('POST /api/v1/projects creates a project', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', description: 'Desc' }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<ProjectResponse>(res);
    expect(body.name).toBe('New Project');
    expect(body.description).toBe('Desc');
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('POST /api/v1/projects rejects missing name', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No name' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
  });

  it('GET /api/v1/projects lists projects', async () => {
    const { app } = await createTestApp();
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Listed' }),
    });

    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse[]>(res);
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe('Listed');
  });

  it('GET /api/v1/projects/:id returns detail with summary counts', async () => {
    const { app, db } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Detail' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);
    await createTask(db, { projectId: created.id, label: 'T1', status: 'todo' });
    await createTask(db, { projectId: created.id, label: 'T2', status: 'done' });

    const res = await app.request(`/api/v1/projects/${created.id}`);
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectDetailResponse>(res);
    expect(body.summary).toEqual({
      scope: 0,
      todo: 1,
      in_progress: 0,
      done: 1,
      backlog: 0,
    });
  });

  it('GET /api/v1/projects/:id returns 404 when missing', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999');
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('GET /api/v1/projects/:id/tasks lists tasks with status filter', async () => {
    const { app, db } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tasks' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);
    await createTask(db, { projectId: created.id, label: 'Todo', status: 'todo' });
    await createTask(db, { projectId: created.id, label: 'Done', status: 'done' });

    const allRes = await app.request(`/api/v1/projects/${created.id}/tasks`);
    expect(allRes.status).toBe(200);
    expect(await parseJson<TaskResponse[]>(allRes)).toHaveLength(2);

    const filteredRes = await app.request(`/api/v1/projects/${created.id}/tasks?status=todo`);
    expect(filteredRes.status).toBe(200);
    const filtered = await parseJson<TaskResponse[]>(filteredRes);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe('todo');
  });

  it('GET /api/v1/projects/:id/tasks returns 404 for missing project', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/tasks');
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('GET /api/v1/projects/:id/tasks returns 400 for invalid status filter', async () => {
    const { app } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Filter' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}/tasks?status=invalid`);
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
  });

  it('POST /api/v1/projects/:id/tasks creates a task', async () => {
    const { app } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Task create' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'New task',
        status: 'todo',
        x: 1,
        y: 2,
        assignee: 'agent',
        due_date: '2026-12-01T00:00:00.000Z',
      }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<TaskResponse>(res);
    expect(body).toMatchObject({
      project_id: created.id,
      label: 'New task',
      status: 'todo',
      x: 1,
      y: 2,
      assignee: 'agent',
    });
  });

  it('POST /api/v1/projects/:id/tasks returns 400 for invalid status', async () => {
    const { app } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad status' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Task', status: 'invalid' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
  });

  it('POST /api/v1/projects/:id/tasks returns 404 for missing project', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/v1/projects/:id/tasks defaults to the project current goal', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Many goals' });
    await createGoal(db, { projectId: project.id, objective: 'Cycle A', status: 'active' });
    const current = await createGoal(db, {
      projectId: project.id,
      objective: 'Cycle B',
      status: 'active',
    });
    await setProjectCurrentGoalId(db, project.id, current.id);

    const res = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'No goal named', status: 'todo' }),
    });

    expect(res.status).toBe(201);
    expect(await parseJson<TaskResponse>(res)).toMatchObject({ goal_id: current.id });
  });

  it('POST /api/v1/projects/:id/tasks returns 400 naming candidates when goals are ambiguous', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Ambiguous' });
    const goalA = await createGoal(db, {
      projectId: project.id,
      objective: 'Cycle A',
      status: 'active',
    });
    const goalB = await createGoal(db, {
      projectId: project.id,
      objective: 'Cycle B',
      status: 'active',
    });
    await setProjectCurrentGoalId(db, project.id, null);

    const res = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'No goal named', status: 'todo' }),
    });

    expect(res.status).toBe(400);
    const body = await parseJson<{ error: string; message: string }>(res);
    expect(body.error).toBe('invalid_argument');
    expect(body.message).toContain(goalA.id);
    expect(body.message).toContain(goalB.id);
  });

  it('PATCH /api/v1/projects/:id renames a project', async () => {
    const { app } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Before' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'After', description: 'Updated' }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse>(res);
    expect(body.name).toBe('After');
    expect(body.description).toBe('Updated');
  });

  it('PATCH owner_id and overview_document_id: set, clear with null, omit leaves unchanged', async () => {
    const { app, db } = await createTestApp();
    const { createDocument } = await import('@plandesk/db');
    const created = await createProject(db, { name: 'Meta' });
    const doc = await createDocument(db, { projectId: created.id, title: 'Spec' });

    const set = await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: 'ada', overview_document_id: doc.id }),
    });
    expect(set.status).toBe(200);
    expect(await parseJson<ProjectResponse>(set)).toMatchObject({
      owner_id: 'ada',
      overview_document_id: doc.id,
    });

    const cleared = await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: null, overview_document_id: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await parseJson<ProjectResponse>(cleared)).toMatchObject({
      owner_id: null,
      overview_document_id: null,
    });

    await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: 'bob', overview_document_id: doc.id }),
    });
    const omitted = await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Still Meta' }),
    });
    expect(omitted.status).toBe(200);
    expect(await parseJson<ProjectResponse>(omitted)).toMatchObject({
      name: 'Still Meta',
      owner_id: 'bob',
      overview_document_id: doc.id,
    });
  });

  it('PATCH overview_document_id rejects a document from another project', async () => {
    const { app, db } = await createTestApp();
    const { createDocument } = await import('@plandesk/db');
    const project = await createProject(db, { name: 'A' });
    const other = await createProject(db, { name: 'B' });
    const foreignDoc = await createDocument(db, { projectId: other.id, title: 'Foreign' });

    const res = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overview_document_id: foreignDoc.id }),
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
  });

  it('POST /api/v1/projects accepts repo_url and folder_path; omitted fields are null', async () => {
    const { app } = await createTestApp();
    const withRepo = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bound',
        repo_url: 'https://github.com/acme/plandesk',
        folder_path: 'packages/plandesk-api',
      }),
    });
    expect(withRepo.status).toBe(201);
    const bound = await parseJson<ProjectResponse>(withRepo);
    expect(bound.repo_url).toBe('https://github.com/acme/plandesk');
    expect(bound.folder_path).toBe('packages/plandesk-api');

    const getRes = await app.request(`/api/v1/projects/${bound.id}`);
    expect(getRes.status).toBe(200);
    const detail = await parseJson<ProjectDetailResponse>(getRes);
    expect(detail.repo_url).toBe('https://github.com/acme/plandesk');
    expect(detail.folder_path).toBe('packages/plandesk-api');

    const bareRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bare' }),
    });
    const bare = await parseJson<ProjectResponse>(bareRes);
    expect(bare.repo_url).toBeNull();
    expect(bare.folder_path).toBeNull();
  });

  it('PATCH /api/v1/projects/:id clears repo_url with null', async () => {
    const { app } = await createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Clearable',
        repo_url: 'https://github.com/acme/plandesk',
        folder_path: 'apps/web',
      }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: null }),
    });
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse>(res);
    expect(body.repo_url).toBeNull();
    expect(body.folder_path).toBe('apps/web');
  });

  it('POST /api/v1/projects rejects a malformed repo_url', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', repo_url: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
  });

  it('POST /api/v1/projects rejects dangerous repo_url schemes and absolute folder_path', async () => {
    const { app } = await createTestApp();
    for (const repo_url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'vbscript:MsgBox(1)',
    ]) {
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad', repo_url }),
      });
      expect(res.status).toBe(400);
      expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
    }
    for (const folder_path of ['/etc', '../../other', 'C:\\Windows', 'a//b', 'trailing/']) {
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad', folder_path }),
      });
      expect(res.status).toBe(400);
      expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
    }
  });

  it('POST /api/v1/projects rejects scp-smuggled schemes and Windows drive-relative folder_path', async () => {
    const { app } = await createTestApp();
    for (const repo_url of [
      'javascript:alert@github.com:org/repo.git',
      'data:text,owned@github.com:org/repo.git',
      'file:C:@github.com:org/repo.git',
    ]) {
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad', repo_url }),
      });
      expect(res.status).toBe(400);
      expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
    }
    for (const folder_path of ['C:..\\secret', 'C:relative\\path', 'C:\\abs', 'c:..']) {
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad', folder_path }),
      });
      expect(res.status).toBe(400);
      expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
    }
  });

  it('POST /api/v1/projects accepts scp-style and ssh:// repo_url', async () => {
    const { app } = await createTestApp();
    const scp = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'SCP',
        repo_url: 'git@github.com:acme/plandesk.git',
        folder_path: 'packages/api',
      }),
    });
    expect(scp.status).toBe(201);
    expect((await parseJson<ProjectResponse>(scp)).repo_url).toBe(
      'git@github.com:acme/plandesk.git',
    );

    const ssh = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'SSH',
        repo_url: 'ssh://git@github.com/acme/plandesk.git',
      }),
    });
    expect(ssh.status).toBe(201);
    expect((await parseJson<ProjectResponse>(ssh)).repo_url).toBe(
      'ssh://git@github.com/acme/plandesk.git',
    );
  });

  it('allows two projects to share one repo_url with different folder_path values', async () => {
    const { app } = await createTestApp();
    const repoUrl = 'https://github.com/acme/monorepo';
    const a = await parseJson<ProjectResponse>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API',
          repo_url: repoUrl,
          folder_path: 'packages/plandesk-api',
        }),
      }),
    );
    const bRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DB',
        repo_url: repoUrl,
        folder_path: 'packages/plandesk-db',
      }),
    });
    expect(bRes.status).toBe(201);
    const b = await parseJson<ProjectResponse>(bRes);
    expect(a.repo_url).toBe(repoUrl);
    expect(b.repo_url).toBe(repoUrl);
    expect(a.folder_path).toBe('packages/plandesk-api');
    expect(b.folder_path).toBe('packages/plandesk-db');

    const list = await parseJson<ProjectResponse[]>(await app.request('/api/v1/projects'));
    const names = list.map((p) => p.name).sort();
    expect(names).toEqual(['API', 'DB']);
  });

  it('PATCH /api/v1/projects/:id returns 404 when missing', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/v1/projects/:id cascade deletes project data', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Delete me' });
    const task = await createTask(db, { projectId: project.id, label: 'Task' });
    await createTask(db, { projectId: project.id, label: 'Other' });

    const res = await app.request(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await app.request(`/api/v1/projects/${project.id}`);
    expect(getRes.status).toBe(404);

    const tasksRes = await app.request(`/api/v1/projects/${project.id}/tasks`);
    expect(tasksRes.status).toBe(404);
    expect(await getTask(db, task.id)).toBeUndefined();
  });

  it('DELETE /api/v1/projects/:id returns 404 when missing', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/projects honors limit and offset', async () => {
    const { app } = await createTestApp();
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A' }),
    });
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    });
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'C' }),
    });

    const res = await app.request('/api/v1/projects?limit=1&offset=1');
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse[]>(res);
    expect(body).toHaveLength(1);
  });

  it('GET /api/v1/projects returns 400 for invalid pagination', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects?limit=-1');
    expect(res.status).toBe(400);
  });
});

describe('tasks routes', () => {
  it('PATCH /api/v1/tasks/:id updates a task', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Patch' });
    const task = await createTask(db, { projectId: project.id, label: 'Before', status: 'todo' });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'in_progress',
        label: 'After',
        description: 'Updated',
        x: 5,
        y: 6,
      }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<TaskResponse>(res);
    expect(body).toMatchObject({
      id: task.id,
      status: 'in_progress',
      label: 'After',
      description: 'Updated',
      x: 5,
      y: 6,
    });
    expect(body.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const listRes = await app.request(`/api/v1/projects/${project.id}/tasks?status=in_progress`);
    const listed = await parseJson<TaskResponse[]>(listRes);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(task.id);
  });

  it('PATCH /api/v1/tasks/:id sets, replaces, and clears commit_refs as a string[]', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Commits' });
    const task = await createTask(db, { projectId: project.id, label: 'Trace' });

    const listed = await parseJson<TaskResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/tasks`),
    );
    expect(listed.find((t) => t.id === task.id)?.commit_refs).toEqual([]);

    const setRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: ['abc1234', 'deadbeef'] }),
    });
    expect(setRes.status).toBe(200);
    expect((await parseJson<TaskResponse>(setRes)).commit_refs).toEqual(['abc1234', 'deadbeef']);

    const replaceRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: ['ffffff0'] }),
    });
    expect((await parseJson<TaskResponse>(replaceRes)).commit_refs).toEqual(['ffffff0']);

    const bad = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: ['NOT-HEX!'] }),
    });
    expect(bad.status).toBe(400);

    const upper = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: ['ABC1234', 'DeAdBeEf'] }),
    });
    expect(upper.status).toBe(200);
    expect((await parseJson<TaskResponse>(upper)).commit_refs).toEqual(['abc1234', 'deadbeef']);

    const fifty = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(7, '0'));
    const atMax = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: fifty }),
    });
    expect(atMax.status).toBe(200);
    expect((await parseJson<TaskResponse>(atMax)).commit_refs).toEqual(fifty);

    const overMax = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: [...fifty, 'aaaaaaa'] }),
    });
    expect(overMax.status).toBe(400);

    const clearRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_refs: null }),
    });
    expect((await parseJson<TaskResponse>(clearRes)).commit_refs).toEqual([]);
  });

  it('PATCH /api/v1/tasks/:id returns 404 when missing', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/tasks/00000000-0000-4000-8000-000000009999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });

    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PATCH /api/v1/tasks/:id returns 400 for invalid status', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Invalid' });
    const task = await createTask(db, { projectId: project.id, label: 'Task' });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toMatchObject({ error: 'invalid_argument' });
  });

  it('DELETE /api/v1/tasks/:id deletes task and cascades edges', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Delete task' });
    const task = await createTask(db, { projectId: project.id, label: 'Task' });
    await createEdge(db, {
      projectId: project.id,
      fromTaskId: task.id,
      toTaskId: task.id,
    });

    const res = await app.request(`/api/v1/tasks/${task.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await getTask(db, task.id)).toBeUndefined();
    expect(await listEdges(db, project.id)).toHaveLength(0);
  });

  it('DELETE /api/v1/tasks/:id returns 404 when missing', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/tasks/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('GET /projects/:id/next-task returns the next actionable task', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Next task' });
    const blocker = await createTask(db, {
      projectId: project.id,
      label: 'Blocker',
      status: 'todo',
    });
    const blocked = await createTask(db, {
      projectId: project.id,
      label: 'Blocked',
      status: 'todo',
    });
    await createEdge(db, {
      projectId: project.id,
      fromTaskId: blocker.id,
      toTaskId: blocked.id,
      label: 'blocks',
    });

    const res = await app.request(`/api/v1/projects/${project.id}/next-task`);
    expect(res.status).toBe(200);
    const body = await parseJson<{
      next_task: TaskResponse | null;
      reason: string;
      blocked: Array<{ task: TaskResponse; waiting_on: TaskResponse[] }>;
    }>(res);
    expect(body.next_task?.id).toBe(blocker.id);
    expect(body.reason).toBe('ok');
    expect(body.blocked).toHaveLength(1);
    expect(body.blocked[0]?.task.id).toBe(blocked.id);
  });

  it('GET /projects/:id/next-task returns 404 for a missing project', async () => {
    const { app } = await createTestApp();
    const res = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/next-task',
    );
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });
});
