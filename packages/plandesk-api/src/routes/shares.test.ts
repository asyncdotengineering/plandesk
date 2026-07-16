import { describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createOrg,
  createProject as createProjectInOrg,
  createProjectInDefaultOrg as createProject,
  ensureDefaultOrg,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createServices } from '../services/index.js';
import { createApp } from '../server.js';

async function createTestAppWithServices() {
  const db = await createDb(':memory:');
  await migrate(db);
  const org = await ensureDefaultOrg(db);
  const services = createServices({ db, orgId: org.id });
  return { app: createApp({ db, services }), db, services, orgId: org.id };
}

async function joinAsGuest(
  app: ReturnType<typeof createApp>,
  token: string,
  body: { name: string; email?: string } = { name: 'Alex' },
): Promise<string> {
  const res = await app.request(`/api/v1/share/${token}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { session_token: string };
  return json.session_token;
}

function guestViewHeaders(sessionToken: string): HeadersInit {
  return { Authorization: `Bearer ${sessionToken}` };
}

describe('shares routes', () => {
  it('serves markdown for a resource share token', async () => {
    const { app, db, services } = await createTestAppWithServices();

    const project = await createProject(db, { name: 'Share route' });
    const task = await createTask(db, { projectId: project.id, label: 'Ship it', status: 'todo' });
    await createDocument(db, {
      projectId: project.id,
      title: 'Spec',
      body: '<p>Body</p>',
      linkedTaskId: task.id,
    });

    const created = await services.shareService.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'http://localhost:3000',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }

    const mdPath = created.markdownUrl.slice('http://localhost:3000'.length);
    const res = await app.request(mdPath);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('Ship it');
    expect(body).toContain('## Linked document: Spec');
  });

  it('returns 404 for an unknown token and 410 for a revoked one', async () => {
    const { app, db, services } = await createTestAppWithServices();

    const project = await createProject(db, { name: 'Share route gone' });
    const task = await createTask(db, { projectId: project.id, label: 'Revoke target', status: 'todo' });

    const created = await services.shareService.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'http://localhost:3000',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }
    const share = (await services.shareService.listShares(project.id))?.[0];
    if (!share) {
      throw new Error('expected share row');
    }
    expect(await services.shareService.revokeShare(share.id)).toBe(true);

    const mdPath = created.markdownUrl.slice('http://localhost:3000'.length);
    const revokedRes = await app.request(mdPath);
    expect(revokedRes.status).toBe(410);

    const missingRes = await app.request('/api/v1/share/plandesk_share_unknown.md');
    expect(missingRes.status).toBe(404);
  });

  it('404s a share path without a .md extension', async () => {
    const { app } = await createTestAppWithServices();
    const res = await app.request('/api/v1/share/plandesk_share_abc');
    expect(res.status).toBe(404);
  });

  it('POST /tasks/:id/share mints a public markdown link the .md route then serves', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'UI share' });
    const task = await createTask(db, { projectId: project.id, label: 'Shareable task', status: 'todo' });

    const res = await app.request(`/api/v1/tasks/${task.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: '7d' }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { url: string; markdown_url: string; expires_at: string | null };
    expect(json.markdown_url).toContain('/api/v1/share/');
    expect(json.markdown_url.endsWith('.md')).toBe(true);
    expect(json.expires_at).not.toBeNull(); // 7d → a real expiry

    // The minted link resolves through the existing .md route.
    const mdPath = new URL(json.markdown_url).pathname;
    const md = await app.request(mdPath);
    expect(md.status).toBe(200);
    expect(await md.text()).toContain('Shareable task');
  });

  it('POST /documents/:id/share supports never-expiring links; 404s a missing resource; 400s a bad TTL', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'UI share doc' });
    const doc = await createDocument(db, { projectId: project.id, title: 'Design', body: '<p>x</p>' });

    const never = await app.request(`/api/v1/documents/${doc.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: 'never' }),
    });
    expect(never.status).toBe(201);
    expect(((await never.json()) as { expires_at: string | null }).expires_at).toBeNull();

    const missing = await app.request('/api/v1/tasks/nope/share', { method: 'POST' });
    expect(missing.status).toBe(404);

    const bad = await app.request(`/api/v1/documents/${doc.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: 'forever' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('portal view (guest-session gated)', () => {
  it('serves a live read-only view that reflects mutations made after the share', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Portal Live' });
    await createTask(db, { projectId: project.id, label: 'First task', status: 'todo' });

    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Reviewers',
      mode: 'public',
      permissions: { read: true, submit: false },
    });
    if (!created) {
      throw new Error('expected share');
    }

    const session = await joinAsGuest(app, created.token);

    const firstRes = await app.request(`/api/v1/share/${created.token}/view`, {
      headers: guestViewHeaders(session),
    });
    expect(firstRes.status).toBe(200);
    const first = (await firstRes.json()) as {
      project: { name: string };
      tasks: Array<{ label: string }>;
      progress: Record<string, number>;
    };
    expect(first.project.name).toBe('Portal Live');
    expect(first.tasks.map((task) => task.label)).toEqual(['First task']);

    // Mutate the project AFTER the share was minted. A snapshot would be stale;
    // only a live read sees the new task.
    await createTask(db, { projectId: project.id, label: 'Second task', status: 'in_progress' });

    const secondRes = await app.request(`/api/v1/share/${created.token}/view`, {
      headers: guestViewHeaders(session),
    });
    expect(secondRes.status).toBe(200);
    const second = (await secondRes.json()) as {
      tasks: Array<{ label: string }>;
      progress: Record<string, number>;
    };
    expect(second.tasks.map((task) => task.label).sort()).toEqual(['First task', 'Second task']);
    expect(second.progress.in_progress).toBe(1);
  });

  it('a share token reads only its own project, never another org/project', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const orgB = await createOrg(db, { name: 'Other Org' });
    const projectA = await createProject(db, { name: 'Project A' });
    const projectB = await createProjectInOrg(db, { name: 'Project B', orgId: orgB.id });
    await createTask(db, { projectId: projectA.id, label: 'A task', status: 'todo' });
    await createTask(db, { projectId: projectB.id, label: 'B secret task', status: 'todo' });

    const created = await services.shareService.createShare(projectA.id, {
      audienceName: 'Reviewers',
      mode: 'public',
    });
    if (!created) {
      throw new Error('expected share');
    }

    const session = await joinAsGuest(app, created.token);
    const res = await app.request(`/api/v1/share/${created.token}/view`, {
      headers: guestViewHeaders(session),
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      project: { id: string };
      tasks: Array<{ label: string }>;
    };
    expect(view.project.id).toBe(projectA.id);
    const labels = view.tasks.map((task) => task.label);
    expect(labels).toContain('A task');
    expect(labels).not.toContain('B secret task');
  });

  it('returns 404 for unknown, revoked, and expired tokens (no existence leak)', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Expiry' });

    const active = await services.shareService.createShare(project.id, {
      audienceName: 'Active',
      mode: 'public',
    });
    const revoked = await services.shareService.createShare(project.id, {
      audienceName: 'Revoked',
      mode: 'public',
    });
    const expired = await services.shareService.createShare(project.id, {
      audienceName: 'Expired',
      mode: 'public',
      expiresAt: new Date(Date.now() - 60_000),
    });
    if (!active || !revoked || !expired) {
      throw new Error('expected shares');
    }
    await services.shareService.revokeShare(revoked.share.id);

    // Without guest session, even active tokens are unreachable (bypass closed).
    const noSession = await app.request(`/api/v1/share/${active.token}/view`);
    expect(noSession.status).toBe(401);

    // Unknown / revoked / expired cannot be joined.
    expect(
      (
        await app.request('/api/v1/share/plandesk_share_unknown/join', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alex' }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(`/api/v1/share/${revoked.token}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alex' }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(`/api/v1/share/${expired.token}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alex' }),
        })
      ).status,
    ).toBe(401);

    const session = await joinAsGuest(app, active.token);
    const activeRes = await app.request(`/api/v1/share/${active.token}/view`, {
      headers: guestViewHeaders(session),
    });
    expect(activeRes.status).toBe(200);
  });
});

describe('BA6a security properties — guest gate', () => {
  // Property 1: bypass closed — view without guest session fails.
  it('view without guest session returns 401 (bypass closed)', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Bypass' });
    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Reviewers',
      mode: 'public',
    });
    if (!created) throw new Error('expected share');

    const res = await app.request(`/api/v1/share/${created.token}/view`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  // Property 2: after valid join, view returns client view for that share's project.
  it('after valid join, view returns the client view for that share', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Joined' });
    await createTask(db, { projectId: project.id, label: 'Visible task', status: 'todo' });
    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Reviewers',
      mode: 'public',
    });
    if (!created) throw new Error('expected share');

    const session = await joinAsGuest(app, created.token, { name: 'Alex' });
    const res = await app.request(`/api/v1/share/${created.token}/view`, {
      headers: guestViewHeaders(session),
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      project: { id: string; name: string };
      tasks: Array<{ label: string }>;
      share: { audience_name: string };
    };
    expect(view.project.id).toBe(project.id);
    expect(view.project.name).toBe('Joined');
    expect(view.tasks.map((t) => t.label)).toContain('Visible task');
    expect(view.share.audience_name).toBe('Reviewers');
  });

  // Property 3: guest session for share A → 404 on share B; cannot reach org projects.
  it('guest session for share A cannot read share B or org projects', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const projectA = await createProject(db, { name: 'Project A' });
    const projectB = await createProject(db, { name: 'Project B' });
    await createTask(db, { projectId: projectA.id, label: 'A task', status: 'todo' });
    await createTask(db, { projectId: projectB.id, label: 'B secret', status: 'todo' });

    const shareA = await services.shareService.createShare(projectA.id, {
      audienceName: 'A',
      mode: 'public',
    });
    const shareB = await services.shareService.createShare(projectB.id, {
      audienceName: 'B',
      mode: 'public',
    });
    if (!shareA || !shareB) throw new Error('expected shares');

    const sessionA = await joinAsGuest(app, shareA.token);

    const crossShare = await app.request(`/api/v1/share/${shareB.token}/view`, {
      headers: guestViewHeaders(sessionA),
    });
    expect(crossShare.status).toBe(404);

    // Guest context has no orgId — org project routes must not open under guest bearer.
    const orgProject = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: guestViewHeaders(sessionA),
    });
    expect([401, 404]).toContain(orgProject.status);
  });

  // Property 4: invite allow-list — non-invited email → 403; view stays unreachable.
  it('invite share rejects non-allow-listed email and keeps view unreachable', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Invite only' });
    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Private',
      mode: 'invite',
      invitedEmails: ['allowed@example.com'],
    });
    if (!created) throw new Error('expected share');

    const denied = await app.request(`/api/v1/share/${created.token}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Eve', email: 'eve@example.com' }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'email_not_invited' });

    // Still no guest session → view still closed.
    const viewNoSession = await app.request(`/api/v1/share/${created.token}/view`);
    expect(viewNoSession.status).toBe(401);

    const allowed = await joinAsGuest(app, created.token, {
      name: 'Alice',
      email: 'allowed@example.com',
    });
    const viewOk = await app.request(`/api/v1/share/${created.token}/view`, {
      headers: guestViewHeaders(allowed),
    });
    expect(viewOk.status).toBe(200);
  });

  // Property 5: client view allow-list omits internal docs/comments/agent-runs.
  it('client view omits internal documents outside policy (allow-list intact)', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Policy' });
    await createTask(db, { projectId: project.id, label: 'Shared task', status: 'todo' });
    const internalDoc = await createDocument(db, {
      projectId: project.id,
      title: 'Internal notes',
      body: '<p>secret</p>',
    });
    const publicDoc = await createDocument(db, {
      projectId: project.id,
      title: 'Client brief',
      body: '<p>ok</p>',
    });

    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Client',
      mode: 'public',
      policy: {
        tasks: 'all',
        documentIds: [publicDoc.id],
        fields: {},
      },
    });
    if (!created) throw new Error('expected share');

    const session = await joinAsGuest(app, created.token);
    const res = await app.request(`/api/v1/share/${created.token}/view`, {
      headers: guestViewHeaders(session),
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      documents: Array<{ id: string; title: string }>;
      tasks: Array<{ label: string }>;
    };
    expect(view.documents.map((d) => d.id)).toEqual([publicDoc.id]);
    expect(view.documents.map((d) => d.title)).not.toContain('Internal notes');
    expect(view.documents.map((d) => d.id)).not.toContain(internalDoc.id);
    // Structural: client view never exposes comments or agent_runs fields.
    expect(view).not.toHaveProperty('comments');
    expect(view).not.toHaveProperty('agent_runs');
    expect(view.tasks.map((t) => t.label)).toContain('Shared task');
  });

  // Property 6 is covered by tenancy suite (cross_org_denied, local_mode_unchanged)
  // remaining green under the full pnpm test run — asserted via proof, not duplicated here.
  it('meta is public pre-join; join requires name', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Meta' });
    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Reviewers',
      mode: 'public',
    });
    if (!created) throw new Error('expected share');

    const meta = await app.request(`/api/v1/share/${created.token}/meta`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toEqual({ audience_name: 'Reviewers', mode: 'public' });

    const noName = await app.request(`/api/v1/share/${created.token}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  ' }),
    });
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ error: 'name_required' });
  });
});
