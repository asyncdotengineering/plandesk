import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createArtifact,
  createProject,
  createProjectInDefaultOrg as createProjectDefault,
} from '@plandesk/db';
import { HTML_ARTIFACT_SHIM, htmlArtifactCsp, resolveRenderOrigin } from '../html-artifact.js';
import { createTestApp, parseJson } from '../test-helpers.js';

type ArtifactResponse = {
  id: string;
  project_id: string;
  title: string;
  kind: string;
  content: string;
  prototype_id: string | null;
  x: number | null;
  y: number | null;
  created_at: string;
  updated_at: string;
};

type ArtifactSummary = {
  id: string;
  title: string;
  kind: string;
  updated_at: string;
};

describe('artifacts routes', () => {
  it('creates, lists, gets, patches, and returns 404 for missing artifact', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Artifacts' });

    const createRes = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'RFC draft',
        kind: 'markdown',
        content: '# Hello',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<ArtifactResponse>(createRes);
    expect(created.project_id).toBe(project.id);
    expect(created.title).toBe('RFC draft');
    expect(created.kind).toBe('markdown');
    expect(created.content).toBe('# Hello');

    const listRes = await app.request(`/api/v1/projects/${project.id}/artifacts`);
    expect(listRes.status).toBe(200);
    const list = await parseJson<ArtifactSummary[]>(listRes);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: created.id,
      title: 'RFC draft',
      kind: 'markdown',
      // Placement travels on the summary so the document tree can file an
      // artifact and exclude a prototype screen without a read per row.
      folder_id: null,
      prototype_id: null,
      revision_id: created.updated_at,
      updated_at: created.updated_at,
    });

    const getRes = await app.request(`/api/v1/artifacts/${created.id}`);
    expect(getRes.status).toBe(200);
    expect((await parseJson<ArtifactResponse>(getRes)).content).toBe('# Hello');

    const patchRes = await app.request(`/api/v1/artifacts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'RFC v2', content: '# Revised', kind: 'html' }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await parseJson<ArtifactResponse>(patchRes);
    expect(updated.title).toBe('RFC v2');
    expect(updated.content).toBe('# Revised');
    expect(updated.kind).toBe('html');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );

    const missingGet = await app.request('/api/v1/artifacts/00000000-0000-4000-8000-000000009999');
    expect(missingGet.status).toBe(404);

    const missingList = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/artifacts',
    );
    expect(missingList.status).toBe(404);
  });

  it('POST rejects missing or blank title with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Validate' });

    const noTitle = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'No title' }),
    });
    expect(noTitle.status).toBe(400);

    const blankTitle = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    expect(blankTitle.status).toBe(400);
  });

  it('POST rejects invalid kind with 400', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Kind validate' });

    const res = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad kind', kind: 'pdf' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /artifacts/:id/render', () => {
  async function createHtmlScreen(
    app: Awaited<ReturnType<typeof createTestApp>>['app'],
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    content: string,
    title = 'Screen',
  ): Promise<string> {
    const project = await createProjectDefault(db, { name: `Render ${title}` });
    const createRes = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, kind: 'html', content }),
    });
    expect(createRes.status).toBe(201);
    return (await parseJson<ArtifactResponse>(createRes)).id;
  }

  it('serves HTML with CSP header, meta copy, shim prepended, and hardening headers', async () => {
    const { app, db } = await createTestApp();
    const content = '<!doctype html><html><body><p>screen</p></body></html>';
    const id = await createHtmlScreen(app, db, content);

    const previous = process.env.PLANDESK_BASE_URL;
    delete process.env.PLANDESK_BASE_URL;
    try {
      const res = await app.request(`http://127.0.0.1:7526/api/v1/artifacts/${id}/render?v=rev-1`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type') ?? '').toMatch(/text\/html/);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');

      const expectedOrigin = 'http://127.0.0.1:7526';
      const expectedCsp = htmlArtifactCsp(expectedOrigin);
      expect(res.headers.get('Content-Security-Policy')).toBe(expectedCsp);
      expect(expectedCsp.startsWith('sandbox allow-scripts;')).toBe(true);

      const body = await res.text();
      expect(body.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
      expect(body).toContain(`content="${expectedCsp}"`);
      expect(body).toContain(HTML_ARTIFACT_SHIM);
      expect(body.indexOf(HTML_ARTIFACT_SHIM)).toBeLessThan(body.indexOf(content));
      expect(body.endsWith(content)).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.PLANDESK_BASE_URL;
      } else {
        process.env.PLANDESK_BASE_URL = previous;
      }
    }
  });

  it('names PLANDESK_BASE_URL in the CSP when set', async () => {
    const { app, db } = await createTestApp();
    const id = await createHtmlScreen(app, db, '<h1>env origin</h1>');
    const previous = process.env.PLANDESK_BASE_URL;
    process.env.PLANDESK_BASE_URL = 'https://boards.example/';
    try {
      const res = await app.request(`http://127.0.0.1:9/api/v1/artifacts/${id}/render`);
      expect(res.status).toBe(200);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain('https://boards.example');
      expect(csp).not.toContain('127.0.0.1');
      expect(resolveRenderOrigin('http://127.0.0.1:9/x', 'https://boards.example/')).toBe(
        'https://boards.example',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.PLANDESK_BASE_URL;
      } else {
        process.env.PLANDESK_BASE_URL = previous;
      }
    }
  });

  it('returns 404 for markdown artifacts and missing ids', async () => {
    const { app, db } = await createTestApp();
    const project = await createProjectDefault(db, { name: 'Not a screen' });
    const createRes = await app.request(`/api/v1/projects/${project.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc', kind: 'markdown', content: '# no' }),
    });
    const md = await parseJson<ArtifactResponse>(createRes);

    expect((await app.request(`/api/v1/artifacts/${md.id}/render`)).status).toBe(404);
    expect(
      (await app.request('/api/v1/artifacts/00000000-0000-4000-8000-000000009999/render')).status,
    ).toBe(404);
  });

  it('REVERT-PROOF: org A cannot render org B HTML (two orgs)', async () => {
    const { app, db, orgId } = await createTestApp();
    const otherOrgId = randomUUID();
    const otherWorkspaceId = randomUUID();

    const projectA = await createProjectDefault(db, { name: 'Org A project' });
    expect(projectA.orgId).toBe(orgId);
    const screenA = await createArtifact(db, {
      projectId: projectA.id,
      title: 'A screen',
      kind: 'html',
      content: '<p>org-a-secret</p>',
    });

    const projectB = await createProject(db, {
      name: 'Org B project',
      orgId: otherOrgId,
      workspaceId: otherWorkspaceId,
    });
    const screenB = await createArtifact(db, {
      projectId: projectB.id,
      title: 'B screen',
      kind: 'html',
      content: '<p>org-b-secret-must-not-leak</p>',
    });

    // Loopback auth context is DEFAULT_ORG (org A). Cross-org get → 404.
    const leak = await app.request(`/api/v1/artifacts/${screenB.id}/render`);
    expect(leak.status).toBe(404);
    expect(await leak.text()).not.toContain('org-b-secret-must-not-leak');

    const own = await app.request(`/api/v1/artifacts/${screenA.id}/render`);
    expect(own.status).toBe(200);
    expect(await own.text()).toContain('org-a-secret');
  });

  it('prepends shim for all three markup shapes and a hostile title', async () => {
    const { app, db } = await createTestApp();
    const shapes = [
      '<!doctype html><html><body>doctype</body></html>',
      '<div id="no-body">fragment</div>',
      '<html><body><script>const x = "</body>";</script></body></html>',
      '<!doctype html><html><head><title></script><script>window.__pwned=1</script></title></head><body>t</body></html>',
    ];

    for (const content of shapes) {
      const id = await createHtmlScreen(app, db, content, `shape-${content.slice(0, 12)}`);
      const res = await app.request(`/api/v1/artifacts/${id}/render`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(HTML_ARTIFACT_SHIM);
      expect(body.endsWith(content)).toBe(true);
      // Shim is a fixed constant — hostile title bytes only appear after it.
      const shimAt = body.indexOf(HTML_ARTIFACT_SHIM);
      expect(body.slice(shimAt, shimAt + HTML_ARTIFACT_SHIM.length)).toBe(HTML_ARTIFACT_SHIM);
    }
  });
});
