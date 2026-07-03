import { describe, expect, it } from 'vitest';
import { createProject } from '@plandesk/db';
import { createTestApp, parseJson, type TaskResponse } from '../test-helpers.js';

type TagResponse = {
  id: string;
  project_id: string;
  name: string;
  color: string | null;
  created_at: string;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('tags routes', () => {
  it('creates, lists, patches, and deletes a tag', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Tags' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/tags`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'backend', color: '#2563eb' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<TagResponse>(createRes);
    expect(created.project_id).toBe(project.id);
    expect(created.name).toBe('backend');
    expect(created.color).toBe('#2563eb');

    const listRes = await app.request(`/api/v1/projects/${project.id}/tags`);
    expect(listRes.status).toBe(200);
    const list = await parseJson<TagResponse[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    const patchRes = await app.request(`/api/v1/tags/${created.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'infra', color: null }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<TagResponse>(patchRes);
    expect(updated.name).toBe('infra');
    expect(updated.color).toBeNull();

    const deleteRes = await app.request(`/api/v1/tags/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);
    const afterList = await parseJson<TagResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/tags`),
    );
    expect(afterList).toHaveLength(0);
  });

  it('rejects blank and duplicate names with 400', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Validate' });

    const blank = await app.request(`/api/v1/projects/${project.id}/tags`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blank.status).toBe(400);

    await app.request(`/api/v1/projects/${project.id}/tags`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'dup' }),
    });
    const dup = await app.request(`/api/v1/projects/${project.id}/tags`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'dup' }),
    });
    expect(dup.status).toBe(400);

    const otherRes = await app.request(`/api/v1/projects/${project.id}/tags`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'other' }),
    });
    const other = await parseJson<TagResponse>(otherRes);
    const rename = await app.request(`/api/v1/tags/${other.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'dup' }),
    });
    expect(rename.status).toBe(400);
  });

  it('returns 404 for unknown project and tag', async () => {
    const { app } = createTestApp();
    const missing = '00000000-0000-4000-8000-000000009999';

    expect((await app.request(`/api/v1/projects/${missing}/tags`)).status).toBe(404);
    expect(
      (
        await app.request(`/api/v1/projects/${missing}/tags`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: 'ghost' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/tags/${missing}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: 'ghost' }),
        })
      ).status,
    ).toBe(404);
    expect((await app.request(`/api/v1/tags/${missing}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('task create/patch accept tags; rename and delete propagate to task listings', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Task tags' });

    const createTaskRes = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'Tagged', tags: ['backend', 'urgent'] }),
    });
    expect(createTaskRes.status).toBe(201);
    const task = await parseJson<TaskResponse & { tags: TagResponse[] }>(createTaskRes);
    expect(task.tags.map((tag) => tag.name)).toEqual(['backend', 'urgent']);

    // update replaces the FULL tag set
    const patchRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tags: ['backend'] }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await parseJson<TaskResponse & { tags: TagResponse[] }>(patchRes);
    expect(patched.tags.map((tag) => tag.name)).toEqual(['backend']);

    const tags = await parseJson<TagResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/tags`),
    );
    const backend = tags.find((tag) => tag.name === 'backend');
    expect(backend).toBeDefined();

    // rename propagates everywhere: single tag row behind the join table
    await app.request(`/api/v1/tags/${backend?.id ?? ''}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'platform' }),
    });
    const afterRename = await parseJson<Array<TaskResponse & { tags: TagResponse[] }>>(
      await app.request(`/api/v1/projects/${project.id}/tasks`),
    );
    expect(afterRename[0]?.tags.map((tag) => tag.name)).toEqual(['platform']);

    // deleting the tag removes it from its tasks
    const deleteRes = await app.request(`/api/v1/tags/${backend?.id ?? ''}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);
    const afterDelete = await parseJson<Array<TaskResponse & { tags: TagResponse[] }>>(
      await app.request(`/api/v1/projects/${project.id}/tasks`),
    );
    expect(afterDelete[0]?.tags).toEqual([]);
  });

  it('GET /projects/:id/tasks?tag=… filters with OR semantics', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Filter' });

    const make = async (label: string, tags: string[]) => {
      const res = await app.request(`/api/v1/projects/${project.id}/tasks`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ label, tags }),
      });
      return parseJson<TaskResponse>(res);
    };
    const hasA = await make('Has a', ['a']);
    const hasB = await make('Has b', ['b']);
    const hasBoth = await make('Has both', ['a', 'b']);
    await make('Untagged', []);

    const orRes = await app.request(`/api/v1/projects/${project.id}/tasks?tag=a&tag=b`);
    expect(orRes.status).toBe(200);
    const orTasks = await parseJson<TaskResponse[]>(orRes);
    expect(orTasks.map((task) => task.id).sort()).toEqual([hasA.id, hasB.id, hasBoth.id].sort());

    const singleTasks = await parseJson<TaskResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/tasks?tag=a`),
    );
    expect(singleTasks.map((task) => task.id).sort()).toEqual([hasA.id, hasBoth.id].sort());

    const noneTasks = await parseJson<TaskResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/tasks?tag=missing`),
    );
    expect(noneTasks).toEqual([]);
  });

  it('rejects non-string-array tags on task create and patch', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Bad tags' });

    const badCreate = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'Bad', tags: 'backend' }),
    });
    expect(badCreate.status).toBe(400);

    const okCreate = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'Ok' }),
    });
    const task = await parseJson<TaskResponse>(okCreate);

    const badPatch = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tags: [1, 2] }),
    });
    expect(badPatch.status).toBe(400);

    const blankName = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tags: ['  '] }),
    });
    expect(blankName.status).toBe(400);
  });
});
