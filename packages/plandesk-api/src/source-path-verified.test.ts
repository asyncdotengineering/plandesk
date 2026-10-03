import { localOwner } from './principal.js';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDocument,
  createDb,
  createProjectInDefaultOrg,
  migrate,
  type Db,
  DEFAULT_ORG_ID,
} from '@plandesk/db';
import { createApp, createBetterAuth, runBetterAuthMigrations } from './index.js';
import { createServices } from './services/index.js';
import { ensureLocalBetterAuthOrganization } from './identity.js';
import { parseJson } from './test-helpers.js';
import type { SerializedDocument } from './serialize.js';
import type { ReferenceCheckResult } from '@plandesk/db';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

describe('source_path, verified_*, and reference-check', () => {
  let db: Db;
  let projectId: string;
  let repoDir: string;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProjectInDefaultOrg(db, { name: 'Repo links' });
    projectId = project.id;
    repoDir = mkdtempSync(join(tmpdir(), 'plandesk-s4-repo-'));
    writeFileSync(join(repoDir, 'alive.md'), '# ok');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  async function testApp() {
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) {
      throw new Error('expected auth');
    }
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);
    const services = createServices({
      db,
      principal: localOwner(DEFAULT_ORG_ID),
      auth,
      referenceCheckFs: { pathExists: existsSync, folderExists: existsSync },
    });
    return createApp({
      db,
      services,
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
      betterAuthInstance: auth,
      bindHost: '127.0.0.1',
    });
  }

  it('round-trips source_path and rejects invalid paths', async () => {
    const app = await testApp();
    const createRes = await app.request(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Spec', source_path: 'docs/spec.md' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<SerializedDocument>(createRes);
    expect(created.source_path).toBe('docs/spec.md');

    const bad = await app.request(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Bad', source_path: '../escape.md' }),
    });
    expect(bad.status).toBe(400);
  });

  it('verified fields round-trip; body edit leaves verified_at unchanged', async () => {
    const app = await testApp();
    const createRes = await app.request(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Checked' }),
    });
    const { id, updated_at: updatedBefore } = await parseJson<SerializedDocument>(createRes);
    const verifiedAt = '2026-01-15T12:00:00.000Z';
    const patchVerified = await app.request(`/api/v1/documents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verified_at: verifiedAt, verified_ref: 'abc1234' }),
    });
    expect(patchVerified.status).toBe(200);
    const verified = await parseJson<SerializedDocument>(patchVerified);
    expect(verified.verified_at).toBe(verifiedAt);
    expect(verified.verified_ref).toBe('abc1234');

    const patchBody = await app.request(`/api/v1/documents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'edited' }),
    });
    const afterBody = await parseJson<SerializedDocument>(patchBody);
    expect(afterBody.verified_at).toBe(verifiedAt);
    expect(afterBody.updated_at).not.toBe(updatedBefore);
  });

  it('rejects verified_ref without verified_at', async () => {
    const app = await testApp();
    const createRes = await app.request(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Doc' }),
    });
    const { id } = await parseJson<SerializedDocument>(createRes);
    const res = await app.request(`/api/v1/documents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verified_ref: 'abc1234' }),
    });
    expect(res.status).toBe(400);
  });

  it('reference-check reports missing files and unknown without folder_path', async () => {
    const app = await testApp();
    await app.request(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', source_path: 'alive.md' }),
    });
    await app.request(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'B', source_path: 'gone.md' }),
    });

    const unknown = await app.request(`/api/v1/projects/${projectId}/reference-check`);
    expect(unknown.status).toBe(200);
    expect(await parseJson<ReferenceCheckResult>(unknown)).toMatchObject({
      checked: 2,
      unknown: true,
      findings: [],
    });

    await app.request(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder_path: repoDir }),
    });

    const check = await app.request(`/api/v1/projects/${projectId}/reference-check`);
    const body = await parseJson<ReferenceCheckResult>(check);
    expect(body.unknown).toBe(false);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({ source_path: 'gone.md', state: 'missing' });
  });

  it('never stores a verification ref without its time', async () => {
    const app = await testApp();
    const doc = await createDocument(db, { projectId, title: 'Invariant', body: '<p>x</p>' });
    const orphan = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_at: null, verified_ref: 'lonely' }),
    });
    expect(orphan.status).toBe(400);

    await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_at: '2026-01-15T12:00:00.000Z', verified_ref: 'abc1234' }),
    });
    const cleared = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_at: null }),
    });
    const after = await parseJson<SerializedDocument>(cleared);
    expect(after.verified_at).toBeNull();
    expect(after.verified_ref).toBeNull();
  });

  it('rejects verification fields on task create rather than dropping them', async () => {
    const app = await testApp();
    const res = await app.request(`/api/v1/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'New', verified_at: '2026-01-15T12:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
  });
});
