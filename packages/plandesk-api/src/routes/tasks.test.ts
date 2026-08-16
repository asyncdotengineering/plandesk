import { describe, expect, it } from 'vitest';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createTestApp, parseJson, type TaskResponse } from '../test-helpers.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('task member routes', () => {
  it('GET /tasks/:id returns the same object PATCH returns (#54)', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Member read' });
    const task = await createTask(db, { projectId: project.id, label: 'Readable' });

    const getRes = await app.request(`/api/v1/tasks/${task.id}`);
    expect(getRes.status).toBe(200);
    const read = await parseJson<TaskResponse>(getRes);
    expect(read.id).toBe(task.id);
    expect(read.label).toBe('Readable');

    // The read/write asymmetry is the defect: a caller that reads then writes
    // on this path must get the same shape back from both verbs.
    const patchRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(patchRes.status).toBe(200);
    const written = await parseJson<TaskResponse>(patchRes);
    expect(Object.keys(written).sort()).toEqual(Object.keys(read).sort());
    // updated_at is excluded: an empty PATCH still stamps the row, so it is the
    // one field the two verbs are expected to disagree on.
    const withoutStamp = (task: TaskResponse): Omit<TaskResponse, 'updated_at'> => {
      const copy: Partial<TaskResponse> = { ...task };
      delete copy.updated_at;
      return copy as Omit<TaskResponse, 'updated_at'>;
    };
    expect(withoutStamp(written)).toEqual(withoutStamp(read));
  });

  it('GET /tasks/:id names the resource and id in its 404 body (#54)', async () => {
    const { app } = await createTestApp();
    const missing = '00000000-0000-4000-8000-000000009999';

    const res = await app.request(`/api/v1/tasks/${missing}`);
    expect(res.status).toBe(404);
    // A bare {"error":"not_found"} is what a read-modify-write script folded
    // into its data, writing the string "undefined" over four descriptions.
    expect(await parseJson<{ error: string; resource: string; id: string }>(res)).toEqual({
      error: 'not_found',
      resource: 'task',
      id: missing,
    });
  });

  it('every path that accepts PATCH :id also serves GET :id (#54)', async () => {
    const { app } = await createTestApp();
    const routes = (app as unknown as { routes: Array<{ path: string; method: string }> }).routes;

    // Comments are read through their parent collection (GET /tasks/:id/comments,
    // GET /documents/:id/comments), so no caller needs a member read. Exemptions
    // are named one at a time; a new resource cannot inherit one by default.
    const exempt = new Set(['/api/v1/comments/:id']);

    const writable = new Set(
      routes.filter((r) => r.method === 'PATCH' && r.path.endsWith('/:id')).map((r) => r.path),
    );
    const readable = new Set(
      routes.filter((r) => r.method === 'GET' && r.path.endsWith('/:id')).map((r) => r.path),
    );

    const missing = [...writable].filter((path) => !readable.has(path) && !exempt.has(path)).sort();
    expect(missing).toEqual([]);
  });

  it('an unsupported method on an existing path returns 405 with Allow (#54)', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Verb probe' });
    const task = await createTask(db, { projectId: project.id, label: 'Probed' });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(405);
    const allow = res.headers.get('Allow') ?? '';
    expect(allow.split(', ').sort()).toEqual(['DELETE', 'GET', 'OPTIONS', 'PATCH']);

    // A path with no route at all stays a 404, so the two stay distinguishable.
    const absent = await app.request('/api/v1/no-such-collection');
    expect(absent.status).toBe(404);
  });
});
