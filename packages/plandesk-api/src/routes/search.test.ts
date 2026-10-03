import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createTaskWithDefaultGoal as createTask,
  deleteDocument,
  updateDocument,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import { createTestApp, parseJson } from '../test-helpers.js';

type SearchPayload = {
  documents: Array<{
    id: string;
    project_id: string;
    title: string;
    matched: 'title' | 'body';
    excerpt: string | null;
  }>;
  tasks: Array<{
    id: string;
    project_id: string;
    label: string;
    matched: 'title' | 'body';
    excerpt: string | null;
  }>;
  notes: Array<{
    id: string;
    project_id: string;
    title: string;
    matched: 'title' | 'body';
    excerpt: string | null;
  }>;
};

async function seedSearchFixture(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  projectId: string,
) {
  const titleDoc = await createDocument(db, {
    projectId,
    title: 'BLUEPRINT overview',
    body: '<p>Unrelated intro</p>',
  });
  const bodyDoc = await createDocument(db, {
    projectId,
    title: 'Retail partners',
    body: '<p>We integrate with Zalando for catalog sync.</p>',
  });
  const pathDoc = await createDocument(db, {
    projectId,
    title: 'Paths',
    body: '<p>See docs/BLUEPRINT-shop-search-and-ingest.md for details.</p>',
  });
  const markupDoc = await createDocument(db, {
    projectId,
    title: 'Markup only',
    body: '<p>Nothing here except <strong>bold</strong> emphasis.</p>',
  });
  const task = await createTask(db, {
    projectId,
    label: 'Housekeeping',
    description: 'Call clearState() before each test run.',
  });
  const shortTitleDoc = await createDocument(db, {
    projectId,
    title: 'AB plan',
    body: '<p>no match in body</p>',
  });
  return { titleDoc, bodyDoc, pathDoc, markupDoc, task, shortTitleDoc };
}

describe('GET /api/v1/search', () => {
  it('returns title matches within the scoped workspace only', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Alpha', workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Beta', workspaceId: wsB });
    await createTask(db, { projectId: projectA.id, label: 'Alpha launch checklist' });
    await createTask(db, { projectId: projectB.id, label: 'Alpha secret task' });

    const scoped = await app.request('/api/v1/search?q=alpha', {
      headers: { 'x-plandesk-workspace-id': wsA },
    });
    expect(scoped.status).toBe(200);
    const body = await parseJson<SearchPayload>(scoped);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.project_id).toBe(projectA.id);
    expect(body.tasks[0]?.label).toContain('Alpha');
    expect(body.tasks[0]?.matched).toBe('title');
  });

  it('searches bodies with excerpts, filters markup-only hits, and ranks title before body', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const ws = randomUUID();
    const project = await createProject(db, { name: 'Search', workspaceId: ws });
    const fixture = await seedSearchFixture(db, project.id);

    const res = await app.request('/api/v1/search?q=BLUEPRINT', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    expect(res.status).toBe(200);
    const body = await parseJson<SearchPayload>(res);
    const titleHit = body.documents.find((doc) => doc.id === fixture.titleDoc.id);
    expect(titleHit?.matched).toBe('title');
    expect(titleHit?.excerpt).toBeNull();

    const zalando = await app.request('/api/v1/search?q=Zalando', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    const zBody = await parseJson<SearchPayload>(zalando);
    const bodyHit = zBody.documents.find((doc) => doc.id === fixture.bodyDoc.id);
    expect(bodyHit?.matched).toBe('body');
    expect(bodyHit?.excerpt?.toLowerCase()).toContain('zalando');

    const path = await app.request('/api/v1/search?q=docs/BLUEPRINT-shop-search-and-ingest.md', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    const pathBody = await parseJson<SearchPayload>(path);
    expect(pathBody.documents.some((doc) => doc.id === fixture.pathDoc.id)).toBe(true);

    const taskRes = await app.request('/api/v1/search?q=clearState', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    const taskBody = await parseJson<SearchPayload>(taskRes);
    expect(taskBody.tasks.some((task) => task.id === fixture.task.id)).toBe(true);
    expect(taskBody.tasks.find((task) => task.id === fixture.task.id)?.excerpt).toContain(
      'clearState',
    );

    const markup = await app.request('/api/v1/search?q=strong', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    const markupBody = await parseJson<SearchPayload>(markup);
    expect(markupBody.documents.some((doc) => doc.id === fixture.markupDoc.id)).toBe(false);

    const rank = await app.request('/api/v1/search?q=BLUEPRINT', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    const rankBody = await parseJson<SearchPayload>(rank);
    const docIds = rankBody.documents.map((doc) => doc.id);
    const titleIdx = docIds.indexOf(fixture.titleDoc.id);
    const pathIdx = docIds.indexOf(fixture.pathDoc.id);
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(pathIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeLessThan(pathIdx);
  });

  it('re-indexes on body edit and removes deleted items', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const ws = randomUUID();
    const project = await createProject(db, { name: 'Search lifecycle', workspaceId: ws });
    const doc = await createDocument(db, {
      projectId: project.id,
      title: 'Mutable',
      body: '<p>alpha token</p>',
    });

    const before = await app.request('/api/v1/search?q=omega', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    expect((await parseJson<SearchPayload>(before)).documents).toHaveLength(0);

    await updateDocument(db, doc.id, { body: '<p>omega token</p>' });
    const afterUpdate = await app.request('/api/v1/search?q=omega', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    expect((await parseJson<SearchPayload>(afterUpdate)).documents[0]?.id).toBe(doc.id);

    await deleteDocument(db, doc.id);
    const afterDelete = await app.request('/api/v1/search?q=omega', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    expect((await parseJson<SearchPayload>(afterDelete)).documents).toHaveLength(0);
  });

  it('uses title-only fallback for queries shorter than three characters', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const ws = randomUUID();
    const project = await createProject(db, { name: 'Short query', workspaceId: ws });
    const fixture = await seedSearchFixture(db, project.id);

    const res = await app.request('/api/v1/search?q=AB', {
      headers: { 'x-plandesk-workspace-id': ws },
    });
    const body = await parseJson<SearchPayload>(res);
    expect(body.documents.some((doc) => doc.id === fixture.shortTitleDoc.id)).toBe(true);
    expect(body.documents.some((doc) => doc.id === fixture.bodyDoc.id)).toBe(false);
  });

  it('returns empty arrays when nothing matches', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const projectA = await createProject(db, { name: 'Alpha', workspaceId: wsA });
    await createTask(db, { projectId: projectA.id, label: 'Ship it' });

    const res = await app.request('/api/v1/search?q=zzznomatch', {
      headers: { 'x-plandesk-workspace-id': wsA },
    });
    expect(res.status).toBe(200);
    const body = await parseJson<SearchPayload>(res);
    expect(body.tasks).toEqual([]);
    expect(body.documents).toEqual([]);
    expect(body.notes).toEqual([]);
  });

  it('ranks before it truncates: a title hit survives a crowd of body hits', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Crowded' });
    // Body-only matches are written first, so an unordered LIMIT would keep
    // them and drop the title match written last.
    for (let i = 0; i < 12; i++) {
      await createDocument(db, {
        projectId: project.id,
        title: `Note ${String(i)}`,
        body: '<p>mentions quokka in passing</p>',
      });
    }
    const titled = await createDocument(db, {
      projectId: project.id,
      title: 'Quokka field guide',
      body: '<p>unrelated</p>',
    });

    const res = await app.request(`/api/v1/search?q=quokka&project_id=${project.id}&limit=1`);
    const body = await parseJson<SearchPayload>(res);
    expect(body.documents.map((d) => d.id)).toEqual([titled.id]);
    expect(body.documents[0]?.matched).toBe('title');
  });

  it('a body with an invalid numeric entity does not take search down', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Poisoned' });
    await createDocument(db, {
      projectId: project.id,
      title: 'Odd bytes',
      body: '<p>wombat &#x110000; trail</p>',
    });
    const res = await app.request(`/api/v1/search?q=wombat&project_id=${project.id}`);
    expect(res.status).toBe(200);
    const body = await parseJson<SearchPayload>(res);
    expect(body.documents).toHaveLength(1);
  });

  it('rejects a non-integer limit with a 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Limits' });
    const res = await app.request(`/api/v1/search?q=abc&project_id=${project.id}&limit=2.5`);
    expect(res.status).toBe(400);
  });

  it('finds text the editor stored with HTML entities', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Entities' });
    const doc = await createDocument(db, {
      projectId: project.id,
      title: 'Cartoons',
      body: '<p>We watched Tom &amp; Jerry and read the Q&amp;A appendix.</p>',
    });
    const res = await app.request(
      `/api/v1/search?q=${encodeURIComponent('Tom & Jerry')}&project_id=${project.id}`,
    );
    const body = await parseJson<SearchPayload>(res);
    expect(body.documents.map((d) => d.id)).toEqual([doc.id]);
    expect(body.documents[0]?.excerpt).toContain('Tom & Jerry');
  });
});
