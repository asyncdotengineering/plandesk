import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID, DEFAULT_WORKSPACE_ID, createDb, migrate, type Db } from '@plandesk/db';
import type { Hono } from 'hono';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { createTeamForOrg, ensureLocalBetterAuthOrganization } from './identity.js';
import { createApp } from './server.js';
import { parseJson } from './test-helpers.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';
const WS_HEADER = 'x-plandesk-workspace-id';

async function loopbackApp(): Promise<{ app: Hono; db: Db; auth: BetterAuthInstance }> {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({ client: db.$client, secret: TEST_SECRET, baseURL: TEST_BASE_URL });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);
  const app = createApp({
    db,
    bindHost: '127.0.0.1',
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
  });
  await ensureLocalBetterAuthOrganization(db, auth);
  return { app, db, auth };
}

type ProjectResponse = { id: string; name: string; workspace_id: string };

/*
 * Regression for the reported bug: a project created from a repo bound to a
 * non-default workspace landed in the org default and was then `not_found` to
 * the agent that had just created it.
 *
 * EVERY assertion here must involve a workspace that is NOT
 * DEFAULT_WORKSPACE_ID. The projects.workspace_id column carries a hardcoded
 * default of exactly that value, so a test written against the default cannot
 * fail — it asserts the bug.
 */
describe('workspace resolution when creating a project', () => {
  it('honours the loopback workspace header instead of the org default', async () => {
    const { app, auth } = await loopbackApp();
    const bound = await createTeamForOrg(auth, DEFAULT_ORG_ID, 'aria-flow');
    expect(bound.id).not.toBe(DEFAULT_WORKSPACE_ID);

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [WS_HEADER]: bound.id },
      body: JSON.stringify({ name: 'Bound project' }),
    });

    expect(res.status).toBe(201);
    const project = await parseJson<ProjectResponse>(res);
    expect(project.workspace_id).toBe(bound.id);
    expect(project.workspace_id).not.toBe(DEFAULT_WORKSPACE_ID);
  });

  it('the created project is then readable under that same workspace scope', async () => {
    const { app, auth } = await loopbackApp();
    const bound = await createTeamForOrg(auth, DEFAULT_ORG_ID, 'aria-flow');

    const created = await parseJson<ProjectResponse>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [WS_HEADER]: bound.id },
        body: JSON.stringify({ name: 'Bound project' }),
      }),
    );

    // This is the half that actually bit: the write succeeded and every
    // follow-up read 404'd because the row was in a different workspace.
    const read = await app.request(`/api/v1/projects/${created.id}`, {
      headers: { [WS_HEADER]: bound.id },
    });
    expect(read.status).toBe(200);
  });

  it('an explicit workspace_id still wins over the header', async () => {
    const { app, auth } = await loopbackApp();
    const bound = await createTeamForOrg(auth, DEFAULT_ORG_ID, 'aria-flow');
    const other = await createTeamForOrg(auth, DEFAULT_ORG_ID, 'other-workspace');

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [WS_HEADER]: bound.id },
      body: JSON.stringify({ name: 'Explicit', workspace_id: other.id }),
    });

    expect(res.status).toBe(201);
    expect((await parseJson<ProjectResponse>(res)).workspace_id).toBe(other.id);
  });

  it('a header naming a workspace that is not a real team is refused, not silently defaulted', async () => {
    const { app } = await loopbackApp();

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WS_HEADER]: '11111111-1111-4111-8111-111111111111',
      },
      body: JSON.stringify({ name: 'Bad header' }),
    });

    // Falling back to the org default here would recreate the exact defect this
    // fixes — the caller would get a 201 for a project they cannot read.
    expect(res.status).not.toBe(201);
  });

  it('with no header at all, behaviour is unchanged: the org default', async () => {
    const { app } = await loopbackApp();

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unscoped' }),
    });

    expect(res.status).toBe(201);
    expect((await parseJson<ProjectResponse>(res)).workspace_id).toBe(DEFAULT_WORKSPACE_ID);
  });
});
