import { describe, expect, it } from 'vitest';
import {
  addOrgMember,
  createProject,
  createTaskWithDefaultGoal as createTask,
  createToken,
  type OrgRole,
  type TokenScope,
} from '@plandesk/db';
import { USER_REF_HEADER } from './auth.js';
import { createTestApp, parseJson } from './test-helpers.js';

async function memberAuth(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  role: OrgRole,
  scope: TokenScope = 'full',
): Promise<{ headers: Record<string, string>; userRef: string }> {
  const userRef = `user-${role}-${scope}`;
  await addOrgMember(db, { orgId, userRef, role });
  const token = await createToken(db, {
    name: `${role} ${scope}`,
    orgId,
    scope,
  });
  return {
    userRef,
    headers: {
      Authorization: `Bearer ${token.token}`,
      [USER_REF_HEADER]: userRef,
      'Content-Type': 'application/json',
    },
  };
}

describe('org member role authorisation', () => {
  it('viewer gets 403 on task update and document create, 200 on reads', async () => {
    const { app, db, orgId } = await createTestApp();
    const project = await createProject(db, { name: 'Board', orgId });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'T1',
      status: 'todo',
    });
    const { headers } = await memberAuth(db, orgId, 'viewer', 'full');

    const readProject = await app.request(`/api/v1/projects/${project.id}`, { headers });
    expect(readProject.status).toBe(200);

    const readTask = await app.request(`/api/v1/projects/${project.id}/tasks`, { headers });
    expect(readTask.status).toBe(200);

    const updateTask = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ label: 'Nope' }),
    });
    expect(updateTask.status).toBe(403);
    expect(await parseJson(updateTask)).toEqual({ error: 'forbidden' });

    const createDoc = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Secret doc' }),
    });
    expect(createDoc.status).toBe(403);
    expect(await parseJson(createDoc)).toEqual({ error: 'forbidden' });
  });

  it('commenter can create a comment but cannot update a task', async () => {
    const { app, db, orgId } = await createTestApp();
    const project = await createProject(db, { name: 'Board', orgId });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'T1',
      status: 'todo',
    });
    const { headers } = await memberAuth(db, orgId, 'commenter', 'full');

    const commentRes = await app.request(`/api/v1/tasks/${task.id}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: 'Looks good' }),
    });
    expect(commentRes.status).toBe(201);
    const comment = await parseJson<{ body: string }>(commentRes);
    expect(comment.body).toBe('Looks good');

    const updateTask = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'done' }),
    });
    expect(updateTask.status).toBe(403);
    expect(await parseJson(updateTask)).toEqual({ error: 'forbidden' });
  });

  it('read-only token gets 403 on write even when the member is an owner', async () => {
    const { app, db, orgId } = await createTestApp();
    const { headers } = await memberAuth(db, orgId, 'owner', 'read-only');

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Should Fail' }),
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });

  it('full token held by a viewer still cannot write (lesser-of rule)', async () => {
    const { app, db, orgId } = await createTestApp();
    const project = await createProject(db, { name: 'Board', orgId });
    const { headers } = await memberAuth(db, orgId, 'viewer', 'full');

    const res = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'Elevated?' }),
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });
});
