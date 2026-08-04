import { describe, expect, it } from 'vitest';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type PrototypeResponse = {
  id: string;
  project_id: string;
  name: string;
  viewport_width: number;
  viewport_height: number;
  created_at: string;
  updated_at: string;
  screens?: Array<{ id: string; title: string; prototype_id: string | null }>;
};

describe('prototypes routes', () => {
  it('creates, lists, gets with screens, and patches', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Protos' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Checkout',
        viewport_width: 390,
        viewport_height: 844,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<PrototypeResponse>(createRes);
    expect(created.name).toBe('Checkout');
    expect(created.viewport_width).toBe(390);

    const listRes = await app.request(`/api/v1/projects/${project.id}/prototypes`);
    expect(listRes.status).toBe(200);
    expect(await parseJson<PrototypeResponse[]>(listRes)).toHaveLength(1);

    const screenRes = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Home',
        kind: 'html',
        content: '<html></html>',
        prototype_id: created.id,
      }),
    });
    expect(screenRes.status).toBe(201);

    const getRes = await app.request(`/api/v1/prototypes/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = await parseJson<PrototypeResponse>(getRes);
    expect(got.screens).toHaveLength(1);
    expect(got.screens?.[0]?.prototype_id).toBe(created.id);

    const patchRes = await app.request(`/api/v1/prototypes/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Checkout v2', viewport_width: 1440, viewport_height: 900 }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<PrototypeResponse>(patchRes);
    expect(updated.name).toBe('Checkout v2');
    expect(updated.viewport_width).toBe(1440);
  });

  it('refuses markdown screen and cross-project prototype_id', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'A' });
    const other = await createProject(db, { name: 'B' });

    const protoRes = await app.request(`/api/v1/projects/${project.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Flow', viewport_width: 390, viewport_height: 844 }),
    });
    const proto = await parseJson<PrototypeResponse>(protoRes);

    const markdown = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Nope',
        kind: 'markdown',
        content: '# x',
        prototype_id: proto.id,
      }),
    });
    expect(markdown.status).toBe(400);
    expect(await parseJson<{ error: string }>(markdown)).toMatchObject({ error: 'invalid_argument' });

    const foreignProtoRes = await app.request(`/api/v1/projects/${other.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other', viewport_width: 390, viewport_height: 844 }),
    });
    const foreign = await parseJson<PrototypeResponse>(foreignProtoRes);

    const cross = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Leak',
        kind: 'html',
        content: '<html></html>',
        prototype_id: foreign.id,
      }),
    });
    expect(cross.status).toBe(400);
    expect(await parseJson<{ error: string }>(cross)).toMatchObject({ error: 'invalid_argument' });
  });

  it('refuses external references at write with 422 naming every offender', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Scan' });
    const protoRes = await app.request(`/api/v1/projects/${project.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Flow', viewport_width: 390, viewport_height: 844 }),
    });
    const proto = await parseJson<PrototypeResponse>(protoRes);

    const res = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Bad',
        kind: 'html',
        content: `
          <script src="https://unpkg.com/x"></script>
          <link href="https://cdn.example/a.css" rel="stylesheet">
          <img src="//images.example/y.png">
        `,
        prototype_id: proto.id,
      }),
    });
    expect(res.status).toBe(422);
    const body = await parseJson<{ error: string; refs: Array<{ url: string }> }>(res);
    expect(body.error).toBe('external_reference');
    expect(body.refs).toHaveLength(3);
    expect(body.refs.map((r) => r.url)).toEqual(
      expect.arrayContaining([
        'https://unpkg.com/x',
        'https://cdn.example/a.css',
        '//images.example/y.png',
      ]),
    );
  });
});

/*
 * The reproduction from plandesk#51: nine payload shapes, including `{}`, all
 * returned a byte-identical `{ error: 'invalid_argument' }`, so the endpoint was
 * reported as not existing. These assert the request shape is now discoverable
 * by probing — which is the only way a caller who does not know it can learn it.
 */
describe('prototype create tells the caller which field is wrong', () => {
  it('names `name` for an empty body', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Protos' });

    const res = await app.request(`/api/v1/projects/${project.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(await parseJson<{ error: string; field?: string }>(res)).toMatchObject({
      error: 'invalid_argument',
      field: 'name',
    });
  });

  // The branch used to test viewport_width and viewport_height together, so a
  // bad height would have been reported as a width problem. Splitting them is
  // what this asserts — naming the wrong field is worse than naming none.
  it('names the viewport field that actually failed, not the first one checked', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Protos' });

    const res = await app.request(`/api/v1/projects/${project.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Checkout', viewport_width: 390, viewport_height: 'tall' }),
    });

    expect(res.status).toBe(400);
    const body = await parseJson<{ error: string; field?: string; message?: string }>(res);
    expect(body.field).toBe('viewport_height');
    expect(body.message).toContain('finite number');
  });
});
