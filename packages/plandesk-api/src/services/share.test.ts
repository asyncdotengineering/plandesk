import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  createDocument,
  createProject,
  getShare,
  getShareByTokenHashRaw,
  hashShareToken,
  listShares,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createEventBus } from '../events.js';
import { createProjectService } from './projects.js';
import { createShareService, InvalidShareError, serializeShare } from './share.js';
import { createSyncService } from './sync.js';
import { createTaskService } from './tasks.js';

describe('shareService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM share_submissions');
    await db.$client.execute('DELETE FROM sync_state');
    await db.$client.execute('DELETE FROM shares');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  function createService() {
    return createShareService({ db, eventBus });
  }

  it('creates a share and returns the raw token once', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Share me' });

    const result = await service.createShare(project.id, {
      audienceName: 'Acme',
      mode: 'invite',
    });

    expect(result?.token).toMatch(/^plandesk_share_/);
    expect(result?.share).toMatchObject({
      project_id: project.id,
      audience_name: 'Acme',
      mode: 'invite',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    expect(result?.share).not.toHaveProperty('token_hash');
    expect(JSON.stringify(result?.share)).not.toContain(result?.token ?? '');
  });

  it('lists shares for a project', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'List shares' });
    await service.createShare(project.id, { audienceName: 'A', mode: 'public' });
    await service.createShare(project.id, { audienceName: 'B', mode: 'invite' });

    const shares = await service.listShares(project.id);
    expect(shares).toHaveLength(2);
    expect(shares?.map((s) => s.audience_name).sort()).toEqual(['A', 'B']);
  });

  it('returns undefined for missing projects', async () => {
    const service = createService();
    expect(
      await service.createShare('00000000-0000-4000-8000-000000009999', {
        audienceName: 'Ghost',
        mode: 'invite',
      }),
    ).toBeUndefined();
    expect(await service.listShares('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('throws InvalidShareError for empty audience names', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Invalid' });
    await expect(service.createShare(project.id, { audienceName: '   ', mode: 'invite' })).rejects.toThrow(
      InvalidShareError,
    );
  });

  it('revokes a share', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Revoke' });
    const created = await service.createShare(project.id, {
      audienceName: 'Revoke',
      mode: 'invite',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }
    expect(await service.revokeShare(created.share.id)).toBe(true);
    expect((await getShare(db, created.share.id))?.revokedAt).toBeTruthy();
    expect(await service.revokeShare(created.share.id)).toBe(false);
  });

  it('buildClientView loads the share projection', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'View' });
    const created = await service.createShare(project.id, {
      audienceName: 'Viewers',
      mode: 'public',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }

    const view = await service.buildClientView(project.id, created.share.id);
    expect(view?.project.name).toBe('View');
    expect(view?.share.audience_name).toBe('Viewers');
  });

  it('serializeShare never includes token_hash', async () => {
    const project = await createProject(db, { name: 'Serialize' });
    const service = createService();
    const created = await service.createShare(project.id, {
      audienceName: 'Serialize',
      mode: 'invite',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }
    const row = await getShare(db, created.share.id);
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    const serialized = serializeShare(row);
    expect(serialized).not.toHaveProperty('token_hash');
    expect(JSON.stringify(serialized)).not.toContain(created.token);
  });

  it('createResourceShare for a task inlines the linked document, includes the agent preamble, and absolutizes a relative image', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Resource shares' });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Ship the thing',
      description: 'See ![before](/api/v1/files/abc123) for context.',
    });
    await createDocument(db, {
      projectId: project.id,
      title: 'Spec',
      body: '<p>Do the work.</p><img src="/api/v1/files/def456" alt="diagram">',
      linkedTaskId: task.id,
    });

    const created = await service.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'https://plandesk.example',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }
    expect(created.url).toBe(`https://plandesk.example/p/${created.token}`);
    expect(created.markdownUrl).toBe(`https://plandesk.example/api/v1/share/${created.token}.md`);
    expect(created.expiresAt).toBeTruthy();

    const markdown = await service.getResourceMarkdown(created.token, 'https://plandesk.example');
    if (markdown.status !== 'ok') {
      throw new Error('expected markdown');
    }
    expect(markdown.markdown).toContain('Agent context. Read every section');
    expect(markdown.markdown).toContain('# Ship the thing');
    expect(markdown.markdown).toContain('## Linked document: Spec');
    expect(markdown.markdown).toContain('https://plandesk.example/api/v1/files/abc123');
    expect(markdown.markdown).toContain('![diagram](https://plandesk.example/api/v1/files/def456)');
    expect(markdown.markdown).toContain('## Images in this context');
    expect(markdown.markdown).toMatch(/- https:\/\/plandesk\.example\/api\/v1\/files\/def456/);
  });

  it('createResourceShare for a document shares just that document', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Doc share' });
    const doc = await createDocument(db, {
      projectId: project.id,
      title: 'RFC',
      body: '<h2>Design</h2>',
    });

    const created = await service.createResourceShare(
      { resource: { kind: 'document', id: doc.id } },
      'https://plandesk.example',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }

    const markdown = await service.getResourceMarkdown(created.token, 'https://plandesk.example');
    if (markdown.status !== 'ok') {
      throw new Error('expected markdown');
    }
    expect(markdown.markdown).toContain('# RFC');
    expect(markdown.markdown).toContain('## Design');
  });

  it('createResourceShare defaults to a 24h expiry; explicit null never expires', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Expiry' });
    const task = await createTask(db, { projectId: project.id, label: 'Expire me' });

    const defaulted = await service.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'https://plandesk.example',
    );
    expect(defaulted?.expiresAt).toBeTruthy();

    const forever = await service.createResourceShare(
      { resource: { kind: 'task', id: task.id }, expiresAt: null },
      'https://plandesk.example',
    );
    expect(forever?.expiresAt).toBeNull();
  });

  it('createResourceShare returns undefined for a missing task or document', async () => {
    const service = createService();
    expect(
      await service.createResourceShare(
        { resource: { kind: 'task', id: '00000000-0000-4000-8000-000000009999' } },
        'https://plandesk.example',
      ),
    ).toBeUndefined();
    expect(
      await service.createResourceShare(
        { resource: { kind: 'document', id: '00000000-0000-4000-8000-000000009999' } },
        'https://plandesk.example',
      ),
    ).toBeUndefined();
  });

  it('getResourceMarkdown returns gone for a revoked or expired token, not_found for an unknown one', async () => {
    const service = createService();
    const project = await createProject(db, { name: 'Gone' });
    const task = await createTask(db, { projectId: project.id, label: 'Revoke me' });

    const revoked = await service.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'https://plandesk.example',
    );
    if (!revoked) {
      throw new Error('expected share to be created');
    }
    const revokedRow = await getShareByTokenHashRaw(db, hashShareToken(revoked.token));
    if (!revokedRow) {
      throw new Error('expected share row');
    }
    expect(await service.revokeShare(revokedRow.id)).toBe(true);
    expect((await service.getResourceMarkdown(revoked.token, 'https://plandesk.example')).status).toBe('gone');

    const expired = await service.createResourceShare(
      { resource: { kind: 'task', id: task.id }, expiresAt: new Date(Date.now() - 1000) },
      'https://plandesk.example',
    );
    if (!expired) {
      throw new Error('expected share to be created');
    }
    expect((await service.getResourceMarkdown(expired.token, 'https://plandesk.example')).status).toBe('gone');

    expect(
      (await service.getResourceMarkdown('plandesk_share_unknown-token', 'https://plandesk.example')).status,
    ).toBe('not_found');
  });

  it('cascade deletes shares when a project is deleted', async () => {
    const projectService = createProjectService({ db, eventBus });
    const shareService = createService();
    const project = await createProject(db, { name: 'Cascade shares' });
    await shareService.createShare(project.id, { audienceName: 'Gone', mode: 'invite' });

    expect(await listShares(db, project.id)).toHaveLength(1);
    expect(await projectService.delete(project.id)).toBe(true);
    expect(await listShares(db, project.id)).toHaveLength(0);
  });

  it('cascade deletes pulled submissions when a project is deleted', async () => {
    const projectService = createProjectService({ db, eventBus });
    const project = await createProject(db, { name: 'Cascade submissions' });
    const taskService = createTaskService({ db, eventBus });
    const shareServiceForSync = createShareService({ db, eventBus });
    const syncService = createSyncService({
      db,
      eventBus,
      taskService,
      shareService: shareServiceForSync,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 'sub-cascade',
              share_id: 'hosted-share-1',
              participant: { id: 'p1', name: 'Alex' },
              title: 'Gone',
              body: null,
              severity: null,
              task_ref: null,
              status: 'pending',
              created_at: '2026-01-15T12:00:00.000Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await syncService.pull(project.id, {
      serverUrl: 'https://sync.example',
      globalProjectId: 'gid-1',
      syncToken: 'plandesk_sync_test',
    });
    expect(await syncService.listTriage(project.id)).toHaveLength(1);

    expect(await projectService.delete(project.id)).toBe(true);
    expect(await syncService.listTriage(project.id)).toHaveLength(0);
  });
});
