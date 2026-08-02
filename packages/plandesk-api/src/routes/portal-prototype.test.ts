import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createArtifact,
  createDb,
  createProject,
  createPrototype,
  migrate,
  revokeShare,
} from '@plandesk/db';
import { createApp } from '../server.js';
import { createShareService } from '../services/share.js';

async function joinAsGuest(app: ReturnType<typeof createApp>, token: string): Promise<string> {
  const response = await app.request(`/api/v1/share/${token}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Portal guest' }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { session_token: string }).session_token;
}

describe('portal prototype access', () => {
  it('allows viewing a shared screen but rejects comments when submit is disabled', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const app = createApp({ db, bindHost: '0.0.0.0' });
    const project = await createProject(db, {
      name: 'View-only portal',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const prototype = await createPrototype(db, {
      projectId: project.id,
      name: 'Read-only flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screen = await createArtifact(db, {
      projectId: project.id,
      title: 'Read-only screen',
      kind: 'html',
      content: '<p>visible</p>',
      prototypeId: prototype.id,
    });
    const shares = createShareService({ db, orgId: project.orgId });
    const share = await shares.createResourceShare(
      { resource: { kind: 'prototype', ids: [prototype.id] } },
      'http://localhost',
    );
    expect(share).toBeDefined();
    if (share === undefined) return;
    const guestSession = await joinAsGuest(app, share.token);

    expect(
      (
        await app.request(
          `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(share.token)}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/share/${share.token}/artifact-comments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${guestSession}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ artifact_id: screen.id, body: '<p>Blocked</p>' }),
        })
      ).status,
    ).toBe(403);
  });

  it('Rule 14: an org A guest share cannot render or comment on an org B screen', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const app = createApp({ db, bindHost: '0.0.0.0' });

    const projectA = await createProject(db, {
      name: 'Org A',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const projectB = await createProject(db, {
      name: 'Org B',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const prototypeA = await createPrototype(db, {
      projectId: projectA.id,
      name: 'A flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const prototypeB = await createPrototype(db, {
      projectId: projectB.id,
      name: 'B flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screenB = await createArtifact(db, {
      projectId: projectB.id,
      title: 'Org B secret',
      kind: 'html',
      content: '<p>org-b-secret</p>',
      prototypeId: prototypeB.id,
    });

    const shares = createShareService({ db, orgId: projectA.orgId });
    const share = await shares.createResourceShare(
      {
        resource: { kind: 'prototype', ids: [prototypeA.id] },
        permissions: { read: true, submit: true },
      },
      'http://localhost',
    );
    expect(share).toBeDefined();
    if (share === undefined) return;
    const guestSession = await joinAsGuest(app, share.token);
    const headers = { Authorization: `Bearer ${guestSession}`, 'Content-Type': 'application/json' };

    const render = await app.request(
      `/api/v1/artifacts/${screenB.id}/render?token=${encodeURIComponent(share.token)}`,
    );
    expect(render.status).toBe(404);
    expect(await render.text()).not.toContain('org-b-secret');

    const list = await app.request(
      `/api/v1/share/${share.token}/artifact-comments?artifact_id=${encodeURIComponent(screenB.id)}`,
      { headers },
    );
    expect(list.status).toBe(404);

    const create = await app.request(`/api/v1/share/${share.token}/artifact-comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        artifact_id: screenB.id,
        body: '<p>crafted cross-org comment</p>',
        passage: 'secret',
        anchor: '{"mode":"point"}',
      }),
    });
    expect(create.status).toBe(404);
  });

  it('Rule 14: revoking a share kills frame render and artifact-comment access', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const app = createApp({ db, bindHost: '0.0.0.0' });
    const project = await createProject(db, {
      name: 'Revocable portal',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const prototype = await createPrototype(db, {
      projectId: project.id,
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screen = await createArtifact(db, {
      projectId: project.id,
      title: 'Pay',
      kind: 'html',
      content: '<p>pay-secret</p>',
      prototypeId: prototype.id,
    });

    const shares = createShareService({ db, orgId: project.orgId });
    const share = await shares.createResourceShare(
      {
        resource: { kind: 'prototype', ids: [prototype.id] },
        permissions: { read: true, submit: true },
      },
      'http://localhost',
    );
    expect(share).toBeDefined();
    if (share === undefined) return;
    const guestSession = await joinAsGuest(app, share.token);
    const headers = { Authorization: `Bearer ${guestSession}`, 'Content-Type': 'application/json' };

    expect(
      (
        await app.request(
          `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(share.token)}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/share/${share.token}/artifact-comments`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ artifact_id: screen.id, body: '<p>Before revoke</p>' }),
        })
      ).status,
    ).toBe(201);

    const row = (await shares.listShares(project.id))?.[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    await revokeShare(db, row.id);

    expect(
      (
        await app.request(
          `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(share.token)}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/share/${share.token}/artifact-comments`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ artifact_id: screen.id, body: '<p>After revoke</p>' }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          `/api/v1/share/${share.token}/artifact-comments?artifact_id=${encodeURIComponent(screen.id)}`,
          { headers },
        )
      ).status,
    ).toBe(401);
  });
});
