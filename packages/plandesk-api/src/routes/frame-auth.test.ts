import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createArtifact,
  createDb,
  createFile,
  createProject,
  createProjectInDefaultOrg as createProjectDefault,
  createPrototype,
  createRenderToken,
  getRenderTokenByHash,
  hashRenderToken,
  migrate,
  revokeRenderToken,
  revokeShare,
  type Db,
} from '@plandesk/db';
import { createOrgOwnerKey } from '../agent-keys.js';
import { createBetterAuth, runBetterAuthMigrations } from '../better-auth.js';
import { createApp } from '../server.js';
import { createShareService } from '../services/share.js';
import { createTestApp, parseJson } from '../test-helpers.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

type MintResponse = {
  token: string;
  expires_at: string;
  prototype_ids: string[];
};

async function seedTwoOrgApps(): Promise<{
  app: ReturnType<typeof createApp>;
  db: Db;
  orgA: { id: string; key: string; projectId: string };
  orgB: { id: string; key: string; projectId: string };
}> {
  const db = await createDb(':memory:');
  await migrate(db);
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const projectA = await createProject(db, {
    name: 'Org A board',
    orgId: orgAId,
    workspaceId: randomUUID(),
  });
  const projectB = await createProject(db, {
    name: 'Org B board',
    orgId: orgBId,
    workspaceId: randomUUID(),
  });

  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    github: { clientId: 'c', clientSecret: 's' },
  });
  if (auth === undefined) {
    throw new Error('expected better-auth');
  }
  await runBetterAuthMigrations(auth);
  const adapter = (await auth.$context).adapter;
  const now = new Date();

  const userA = await adapter.create<{ id: string }>({
    model: 'user',
    data: {
      name: 'Owner A',
      email: `a-frame-${randomUUID()}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  const userB = await adapter.create<{ id: string }>({
    model: 'user',
    data: {
      name: 'Owner B',
      email: `b-frame-${randomUUID()}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  for (const [userId, accountId] of [
    [userA.id, '9100'],
    [userB.id, '9101'],
  ] as const) {
    await adapter.create({
      model: 'account',
      data: {
        accountId,
        providerId: 'github',
        userId,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  await adapter.create({
    model: 'organization',
    data: {
      id: orgAId,
      name: 'Org A',
      slug: `org-a-${randomUUID().slice(0, 8)}`,
      createdAt: now,
    },
    forceAllowId: true,
  });
  await adapter.create({
    model: 'organization',
    data: {
      id: orgBId,
      name: 'Org B',
      slug: `org-b-${randomUUID().slice(0, 8)}`,
      createdAt: now,
    },
    forceAllowId: true,
  });
  await adapter.create({
    model: 'member',
    data: {
      organizationId: orgAId,
      userId: userA.id,
      role: 'owner',
      createdAt: now,
    },
  });
  await adapter.create({
    model: 'member',
    data: {
      organizationId: orgBId,
      userId: userB.id,
      role: 'owner',
      createdAt: now,
    },
  });

  const keyA = await createOrgOwnerKey({
    auth,
    userId: userA.id,
    orgId: orgAId,
    name: 'a-frame-key',
  });
  const keyB = await createOrgOwnerKey({
    auth,
    userId: userB.id,
    orgId: orgBId,
    name: 'b-frame-key',
  });

  const app = createApp({
    db,
    bindHost: '0.0.0.0',
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    github: { clientId: 'c', clientSecret: 's', callbackUrl: 'https://x.test/cb' },
  });

  return {
    app,
    db,
    orgA: { id: orgAId, key: keyA.key, projectId: projectA.id },
    orgB: { id: orgBId, key: keyB.key, projectId: projectB.id },
  };
}

describe('frame auth (render token + share credential)', () => {
  it('rewrites plandesk://file/ on render without storing base64 in artifacts.content', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Rewrite' });
    const proto = await createPrototype(db, {
      projectId: project.id,
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const bytes = Buffer.from('fake-png', 'utf8');
    const file = await createFile(db, {
      id: 'a'.repeat(64),
      projectId: project.id,
      filename: 'shot.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    const content = `<img src="plandesk://file/${file.id}" alt="shot">`;
    const screen = await createArtifact(db, {
      projectId: project.id,
      title: 'Home',
      kind: 'html',
      content,
      prototypeId: proto.id,
    });

    const previous = process.env.PLANDESK_BASE_URL;
    process.env.PLANDESK_BASE_URL = 'https://boards.example';
    try {
      const res = await app.request(`http://127.0.0.1:7526/api/v1/artifacts/${screen.id}/render`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`https://boards.example/api/v1/files/${file.id}?token=`);
      expect(body).not.toContain('plandesk://file/');
      expect(body).not.toContain(bytes.toString('base64'));

      const stored = await app.request(`/api/v1/artifacts/${screen.id}`);
      const storedJson = await parseJson<{ content: string }>(stored);
      expect(storedJson.content).toBe(content);
      expect(storedJson.content).not.toMatch(/base64/);
    } finally {
      if (previous === undefined) {
        delete process.env.PLANDESK_BASE_URL;
      } else {
        process.env.PLANDESK_BASE_URL = previous;
      }
    }
  });

  it('token path serves files on non-loopback without a session cookie', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0' });
    const project = await createProject(db, {
      name: 'Off-loop',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const proto = await createPrototype(db, {
      projectId: project.id,
      name: 'Flow',
      viewportWidth: 1,
      viewportHeight: 1,
    });
    const bytes = Buffer.from('img-bytes', 'utf8');
    const file = await createFile(db, {
      id: 'b'.repeat(64),
      projectId: project.id,
      filename: 'a.png',
      mime: 'image/png',
      size: bytes.length,
      bytes,
    });
    const minted = await createRenderToken(db, {
      orgId: project.orgId,
      projectId: project.id,
      prototypeIds: [proto.id],
    });

    expect((await app.request(`/api/v1/files/${file.id}`)).status).toBe(401);

    const allowed = await app.request(
      `/api/v1/files/${file.id}?token=${encodeURIComponent(minted.token)}`,
    );
    expect(allowed.status).toBe(200);
    expect(Buffer.from(await allowed.arrayBuffer())).toEqual(bytes);

    const screen = await createArtifact(db, {
      projectId: project.id,
      title: 'S',
      kind: 'html',
      content: `<img src="plandesk://file/${file.id}">`,
      prototypeId: proto.id,
    });
    const render = await app.request(
      `https://boards.example/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(minted.token)}`,
    );
    expect(render.status).toBe(200);
    const html = await render.text();
    expect(html).toContain(`https://boards.example/api/v1/files/${file.id}?token=`);
    expect(html).toContain('img-src data: blob: https://boards.example');
  });

  it('share token covers portal guest render; revoke kills access', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Portal' });
    const proto = await createPrototype(db, {
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
      prototypeId: proto.id,
    });

    const shares = createShareService({ db, orgId: project.orgId });
    const minted = await shares.createResourceShare(
      { resource: { kind: 'prototype', ids: [proto.id] }, expiresAt: null },
      'http://localhost',
    );
    expect(minted).toBeDefined();
    if (!minted) {
      return;
    }

    const live = await app.request(
      `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(minted.token)}`,
    );
    expect(live.status).toBe(200);
    expect(await live.text()).toContain('pay-secret');

    const listed = await shares.listShares(project.id);
    const row = listed?.find((s) => (s.policy.prototypeIds ?? []).includes(proto.id));
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    await revokeShare(db, row.id);

    const dead = await app.request(
      `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(minted.token)}`,
    );
    expect(dead.status).toBe(404);
    expect(await dead.text()).not.toContain('pay-secret');
  });

  it('expired render token behaves as revoked', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Expiry' });
    const proto = await createPrototype(db, {
      projectId: project.id,
      name: 'Flow',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screen = await createArtifact(db, {
      projectId: project.id,
      title: 'S',
      kind: 'html',
      content: '<p>secret</p>',
      prototypeId: proto.id,
    });

    const expired = await createRenderToken(db, {
      orgId: project.orgId,
      projectId: project.id,
      prototypeIds: [proto.id],
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(
      (
        await app.request(
          `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(expired.token)}`,
        )
      ).status,
    ).toBe(404);

    const live = await createRenderToken(db, {
      orgId: project.orgId,
      projectId: project.id,
      prototypeIds: [proto.id],
    });
    await revokeRenderToken(db, live.row.id);
    expect(
      (
        await app.request(
          `/api/v1/artifacts/${screen.id}/render?token=${encodeURIComponent(live.token)}`,
        )
      ).status,
    ).toBe(404);
    expect(await getRenderTokenByHash(db, hashRenderToken(live.token))).toBeUndefined();
  });

  it('token for prototype A cannot render prototype B screen; cross-project file 404', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Scope' });
    const other = await createProjectDefault(db, { name: 'Other project' });
    const protoA = await createPrototype(db, {
      projectId: project.id,
      name: 'A',
      viewportWidth: 1,
      viewportHeight: 1,
    });
    const protoB = await createPrototype(db, {
      projectId: project.id,
      name: 'B',
      viewportWidth: 1,
      viewportHeight: 1,
    });
    const screenA = await createArtifact(db, {
      projectId: project.id,
      title: 'A',
      kind: 'html',
      content: '<p>a</p>',
      prototypeId: protoA.id,
    });
    const screenB = await createArtifact(db, {
      projectId: project.id,
      title: 'B',
      kind: 'html',
      content: '<p>b-secret</p>',
      prototypeId: protoB.id,
    });
    const foreignFile = await createFile(db, {
      id: 'c'.repeat(64),
      projectId: other.id,
      filename: 'x.png',
      mime: 'image/png',
      size: 1,
      bytes: Buffer.from('x'),
    });

    const token = await createRenderToken(db, {
      orgId: project.orgId,
      projectId: project.id,
      prototypeIds: [protoA.id],
    });

    expect(
      (
        await app.request(
          `/api/v1/artifacts/${screenA.id}/render?token=${encodeURIComponent(token.token)}`,
        )
      ).status,
    ).toBe(200);

    const leakScreen = await app.request(
      `/api/v1/artifacts/${screenB.id}/render?token=${encodeURIComponent(token.token)}`,
    );
    expect(leakScreen.status).toBe(404);
    expect(await leakScreen.text()).not.toContain('b-secret');

    const leakFile = await app.request(
      `/api/v1/files/${foreignFile.id}?token=${encodeURIComponent(token.token)}`,
    );
    expect(leakFile.status).toBe(404);
  });

  it('REVERT-PROOF: org A cannot mint or use a token for org B (two orgs)', async () => {
    const { app, db, orgA, orgB } = await seedTwoOrgApps();
    const protoB = await createPrototype(db, {
      projectId: orgB.projectId,
      name: 'Secret',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screenB = await createArtifact(db, {
      projectId: orgB.projectId,
      title: 'B',
      kind: 'html',
      content: '<p>org-b-must-not-leak</p>',
      prototypeId: protoB.id,
    });
    const fileB = await createFile(db, {
      id: 'd'.repeat(64),
      projectId: orgB.projectId,
      filename: 'b.png',
      mime: 'image/png',
      size: 1,
      bytes: Buffer.from('b'),
    });

    const mintCross = await app.request(`/api/v1/projects/${orgB.projectId}/render-tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${orgA.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prototype_ids: [protoB.id] }),
    });
    expect(mintCross.status).toBe(404);

    const mintedB = await createRenderToken(db, {
      orgId: orgB.id,
      projectId: orgB.projectId,
      prototypeIds: [protoB.id],
    });

    const sessionLeak = await app.request(`/api/v1/artifacts/${screenB.id}/render`, {
      headers: { Authorization: `Bearer ${orgA.key}` },
    });
    expect(sessionLeak.status).toBe(404);
    expect(await sessionLeak.text()).not.toContain('org-b-must-not-leak');

    const protoA = await createPrototype(db, {
      projectId: orgA.projectId,
      name: 'A flow',
      viewportWidth: 1,
      viewportHeight: 1,
    });
    const mintA = await app.request(`/api/v1/projects/${orgA.projectId}/render-tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${orgA.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prototype_ids: [protoA.id] }),
    });
    expect(mintA.status).toBe(201);
    const tokenA = await parseJson<MintResponse>(mintA);

    const withA = await app.request(
      `/api/v1/artifacts/${screenB.id}/render?token=${encodeURIComponent(tokenA.token)}`,
    );
    expect(withA.status).toBe(404);
    expect(await withA.text()).not.toContain('org-b-must-not-leak');

    const fileWithA = await app.request(
      `/api/v1/files/${fileB.id}?token=${encodeURIComponent(tokenA.token)}`,
    );
    expect(fileWithA.status).toBe(404);

    const withB = await app.request(
      `/api/v1/artifacts/${screenB.id}/render?token=${encodeURIComponent(mintedB.token)}`,
    );
    expect(withB.status).toBe(200);
    expect(await withB.text()).toContain('org-b-must-not-leak');
  });
});
