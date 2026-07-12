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
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createEventBus } from '../events.js';
import { createProjectService } from './projects.js';
import { createShareService, InvalidShareError, serializeShare } from './share.js';
import { createSyncService } from './sync.js';
import { createTaskService } from './tasks.js';

describe('shareService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM share_submissions');
    db.$client.exec('DELETE FROM sync_state');
    db.$client.exec('DELETE FROM shares');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createService() {
    return createShareService({ db, eventBus });
  }

  it('creates a share and returns the raw token once', () => {
    const service = createService();
    const project = createProject(db, { name: 'Share me' });

    const result = service.createShare(project.id, {
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

  it('lists shares for a project', () => {
    const service = createService();
    const project = createProject(db, { name: 'List shares' });
    service.createShare(project.id, { audienceName: 'A', mode: 'public' });
    service.createShare(project.id, { audienceName: 'B', mode: 'invite' });

    const shares = service.listShares(project.id);
    expect(shares).toHaveLength(2);
    expect(shares?.map((s) => s.audience_name).sort()).toEqual(['A', 'B']);
  });

  it('returns undefined for missing projects', () => {
    const service = createService();
    expect(
      service.createShare('00000000-0000-4000-8000-000000009999', {
        audienceName: 'Ghost',
        mode: 'invite',
      }),
    ).toBeUndefined();
    expect(service.listShares('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('throws InvalidShareError for empty audience names', () => {
    const service = createService();
    const project = createProject(db, { name: 'Invalid' });
    expect(() => service.createShare(project.id, { audienceName: '   ', mode: 'invite' })).toThrow(
      InvalidShareError,
    );
  });

  it('revokes a share', () => {
    const service = createService();
    const project = createProject(db, { name: 'Revoke' });
    const created = service.createShare(project.id, {
      audienceName: 'Revoke',
      mode: 'invite',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }
    expect(service.revokeShare(created.share.id)).toBe(true);
    expect(getShare(db, created.share.id)?.revokedAt).toBeTruthy();
    expect(service.revokeShare(created.share.id)).toBe(false);
  });

  it('buildClientView loads the share projection', () => {
    const service = createService();
    const project = createProject(db, { name: 'View' });
    const created = service.createShare(project.id, {
      audienceName: 'Viewers',
      mode: 'public',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }

    const view = service.buildClientView(project.id, created.share.id);
    expect(view?.project.name).toBe('View');
    expect(view?.share.audience_name).toBe('Viewers');
  });

  it('serializeShare never includes token_hash', () => {
    const project = createProject(db, { name: 'Serialize' });
    const service = createService();
    const created = service.createShare(project.id, {
      audienceName: 'Serialize',
      mode: 'invite',
    });
    if (!created) {
      throw new Error('expected share to be created');
    }
    const row = getShare(db, created.share.id);
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    const serialized = serializeShare(row);
    expect(serialized).not.toHaveProperty('token_hash');
    expect(JSON.stringify(serialized)).not.toContain(created.token);
  });

  it('createResourceShare for a task inlines the linked document, includes the agent preamble, and absolutizes a relative image', () => {
    const service = createService();
    const project = createProject(db, { name: 'Resource shares' });
    const task = createTask(db, {
      projectId: project.id,
      label: 'Ship the thing',
      description: 'See ![before](/api/v1/files/abc123) for context.',
    });
    createDocument(db, {
      projectId: project.id,
      title: 'Spec',
      body: '<p>Do the work.</p><img src="/api/v1/files/def456" alt="diagram">',
      linkedTaskId: task.id,
    });

    const created = service.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'https://plandesk.example',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }
    expect(created.url).toBe(`https://plandesk.example/p/${created.token}`);
    expect(created.markdownUrl).toBe(`https://plandesk.example/api/v1/share/${created.token}.md`);
    expect(created.expiresAt).toBeTruthy();

    const markdown = service.getResourceMarkdown(created.token, 'https://plandesk.example');
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

  it('createResourceShare for a document shares just that document', () => {
    const service = createService();
    const project = createProject(db, { name: 'Doc share' });
    const doc = createDocument(db, {
      projectId: project.id,
      title: 'RFC',
      body: '<h2>Design</h2>',
    });

    const created = service.createResourceShare(
      { resource: { kind: 'document', id: doc.id } },
      'https://plandesk.example',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }

    const markdown = service.getResourceMarkdown(created.token, 'https://plandesk.example');
    if (markdown.status !== 'ok') {
      throw new Error('expected markdown');
    }
    expect(markdown.markdown).toContain('# RFC');
    expect(markdown.markdown).toContain('## Design');
  });

  it('createResourceShare defaults to a 24h expiry; explicit null never expires', () => {
    const service = createService();
    const project = createProject(db, { name: 'Expiry' });
    const task = createTask(db, { projectId: project.id, label: 'Expire me' });

    const defaulted = service.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'https://plandesk.example',
    );
    expect(defaulted?.expiresAt).toBeTruthy();

    const forever = service.createResourceShare(
      { resource: { kind: 'task', id: task.id }, expiresAt: null },
      'https://plandesk.example',
    );
    expect(forever?.expiresAt).toBeNull();
  });

  it('createResourceShare returns undefined for a missing task or document', () => {
    const service = createService();
    expect(
      service.createResourceShare(
        { resource: { kind: 'task', id: '00000000-0000-4000-8000-000000009999' } },
        'https://plandesk.example',
      ),
    ).toBeUndefined();
    expect(
      service.createResourceShare(
        { resource: { kind: 'document', id: '00000000-0000-4000-8000-000000009999' } },
        'https://plandesk.example',
      ),
    ).toBeUndefined();
  });

  it('getResourceMarkdown returns gone for a revoked or expired token, not_found for an unknown one', () => {
    const service = createService();
    const project = createProject(db, { name: 'Gone' });
    const task = createTask(db, { projectId: project.id, label: 'Revoke me' });

    const revoked = service.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'https://plandesk.example',
    );
    if (!revoked) {
      throw new Error('expected share to be created');
    }
    const revokedRow = getShareByTokenHashRaw(db, hashShareToken(revoked.token));
    if (!revokedRow) {
      throw new Error('expected share row');
    }
    expect(service.revokeShare(revokedRow.id)).toBe(true);
    expect(service.getResourceMarkdown(revoked.token, 'https://plandesk.example').status).toBe('gone');

    const expired = service.createResourceShare(
      { resource: { kind: 'task', id: task.id }, expiresAt: new Date(Date.now() - 1000) },
      'https://plandesk.example',
    );
    if (!expired) {
      throw new Error('expected share to be created');
    }
    expect(service.getResourceMarkdown(expired.token, 'https://plandesk.example').status).toBe('gone');

    expect(
      service.getResourceMarkdown('plandesk_share_unknown-token', 'https://plandesk.example').status,
    ).toBe('not_found');
  });

  it('cascade deletes shares when a project is deleted', () => {
    const projectService = createProjectService({ db, eventBus });
    const shareService = createService();
    const project = createProject(db, { name: 'Cascade shares' });
    shareService.createShare(project.id, { audienceName: 'Gone', mode: 'invite' });

    expect(listShares(db, project.id)).toHaveLength(1);
    expect(projectService.delete(project.id)).toBe(true);
    expect(listShares(db, project.id)).toHaveLength(0);
  });

  it('cascade deletes pulled submissions when a project is deleted', async () => {
    const projectService = createProjectService({ db, eventBus });
    const project = createProject(db, { name: 'Cascade submissions' });
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
    expect(syncService.listTriage(project.id)).toHaveLength(1);

    expect(projectService.delete(project.id)).toBe(true);
    expect(syncService.listTriage(project.id)).toHaveLength(0);
  });
});
