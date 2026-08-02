import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createComment,
  createDb,
  createDocument,
  createEdge,
  createFolder,
  createGoal,
  createProjectInDefaultOrg as createProject,
  getComment,
  getDocument,
  getTask,
  listCommentsByTarget,
  listEdges,
  listRevisionsByTarget,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { ensureHtmlBody } from '../markdown.js';
import { PermissionDeniedError } from '../permissions.js';
import { createDocumentService, InvalidDocumentError, type DocumentServiceDeps } from './documents.js';
import { createTaskService } from './tasks.js';

describe('documentService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  let projectId = '';
  let orgId = '';

  function createService(extra?: Omit<DocumentServiceDeps, 'db' | 'orgId' | 'taskService'>) {
    const taskService = createTaskService({ db, orgId, ...extra });
    return createDocumentService({ db, orgId, taskService, ...extra });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM comments');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('UPDATE folders SET parent_folder_id = NULL');
    await db.$client.execute('DELETE FROM folders');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    const project = await createProject(db, { name: 'Docs' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('creates a document with structured content', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Task' });
    const document = await service.create(projectId, {
      title: 'Spec',
      body: '# Overview',
      statusLine: 'Status: draft',
    });
    expect(document).toBeDefined();
    if (!document) {
      return;
    }
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: document.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    const fetched = await service.get(document.id);
    expect(fetched).toMatchObject({
      title: 'Spec',
      body: ensureHtmlBody('# Overview'),
      status_line: 'Status: draft',
      project_id: projectId,
      links: [
        {
          type: 'task',
          id: task.id,
          title: 'Task',
          label: 'documents',
        },
      ],
      backlinks: [],
    });
    expect(typeof fetched?.links[0]?.edge_id).toBe('string');
    expect(fetched?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('document linked to three tasks returns all three in links', async () => {
    const service = createService();
    const t1 = await createTask(db, { projectId, label: 'One' });
    const t2 = await createTask(db, { projectId, label: 'Two' });
    const t3 = await createTask(db, { projectId, label: 'Three' });
    const document = await service.create(projectId, { title: 'Multi' });
    expect(document).toBeDefined();
    if (!document) {
      return;
    }

    for (const task of [t1, t2, t3]) {
      await createEdge(db, {
        projectId,
        fromType: 'document',
        fromId: document.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });
    }

    const fetched = await service.get(document.id);
    expect(fetched?.links).toHaveLength(3);
    expect(fetched?.links.map((l) => l.id).sort()).toEqual([t1.id, t2.id, t3.id].sort());
    expect(fetched?.links.map((l) => l.title).sort()).toEqual(['One', 'Three', 'Two']);
    expect(fetched?.links.every((l) => l.type === 'task' && l.label === 'documents')).toBe(true);
  });

  it('document A linking to document B puts B in A.links and A in B.backlinks', async () => {
    const service = createService();
    const docA = await service.create(projectId, { title: 'Doc A' });
    const docB = await service.create(projectId, { title: 'Doc B' });
    expect(docA && docB).toBeTruthy();
    if (!docA || !docB) {
      return;
    }

    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: docA.id,
      toType: 'document',
      toId: docB.id,
      label: 'references',
    });

    const a = await service.get(docA.id);
    const b = await service.get(docB.id);
    if (a === undefined) {
      throw new Error('missing document A');
    }
    const firstLink = a.links[0];
    if (firstLink === undefined) {
      throw new Error('missing document A link');
    }
    expect(a.links).toEqual([
      {
        type: 'document',
        id: docB.id,
        title: 'Doc B',
        label: 'references',
        edge_id: firstLink.edge_id,
      },
    ]);
    expect(typeof firstLink.edge_id).toBe('string');
    expect(b?.backlinks).toEqual([
      {
        type: 'document',
        id: docA.id,
        title: 'Doc A',
        label: 'references',
        edge_id: firstLink.edge_id,
      },
    ]);
  });

  it('task backlinks report every document that links to it', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Shared' });
    const d1 = await service.create(projectId, { title: 'Spec' });
    const d2 = await service.create(projectId, { title: 'Notes' });
    expect(d1 && d2).toBeTruthy();
    if (!d1 || !d2) {
      return;
    }
    for (const doc of [d1, d2]) {
      await createEdge(db, {
        projectId,
        fromType: 'document',
        fromId: doc.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });
    }

    const backlinks = await service.listBacklinks('task', task.id);
    expect(backlinks).toBeDefined();
    expect(backlinks?.map((l) => l.id).sort()).toEqual([d1.id, d2.id].sort());
    expect(backlinks?.every((l) => l.type === 'document' && l.label === 'documents')).toBe(true);
    expect(backlinks?.map((l) => l.title).sort()).toEqual(['Notes', 'Spec']);
  });

  it('backlinks from another org return nothing and leak no titles', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Secret task' });
    const secret = await service.create(projectId, {
      title: 'Secret doc',
    });
    expect(secret).toBeDefined();
    if (!secret) {
      return;
    }
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: secret.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    const foreignService = createDocumentService({
      db,
      orgId: '00000000-0000-4000-8000-00000000ffff',
    });
    expect(await foreignService.listBacklinks('task', task.id)).toBeUndefined();
    expect(await foreignService.listBacklinks('document', secret.id)).toBeUndefined();
    expect(await foreignService.get(secret.id)).toBeUndefined();
  });

  it('returns nested document tree', async () => {
    const service = createService();
    const parent = await createDocument(db, { projectId, title: 'Parent' });
    await createDocument(db, { projectId, title: 'Child', parentId: parent.id });

    const tree = await service.listTree(projectId);
    expect(tree).toHaveLength(1);
    expect(tree?.[0]?.title).toBe('Parent');
    expect(tree?.[0]?.children).toHaveLength(1);
    expect(tree?.[0]?.children[0]?.title).toBe('Child');
    expect(tree?.[0]?.children[0]?.parent_id).toBe(parent.id);
  });

  it('creates a document inside a folder and moves it via update', async () => {
    const service = createService();
    const folder = await createFolder(db, { projectId, name: 'Specs' });
    const document = await service.create(projectId, { title: 'In folder', folderId: folder.id });
    expect(document?.folder_id).toBe(folder.id);
    if (!document) {
      return;
    }

    const moved = await service.update(document.id, { folderId: null });
    expect(moved?.folder_id).toBeNull();
  });

  it('rejects a folder from another project on create and update', async () => {
    const service = createService();
    const otherProjectId = (await createProject(db, { name: 'Other' })).id;
    const foreignFolder = await createFolder(db, { projectId: otherProjectId, name: 'Foreign' });

    await expect(service.create(projectId, { title: 'Doc', folderId: foreignFolder.id })).rejects.toThrow(
      InvalidDocumentError,
    );

    const document = await service.create(projectId, { title: 'Doc' });
    expect(document).toBeDefined();
    if (!document) {
      return;
    }
    await expect(service.update(document.id, { folderId: foreignFolder.id })).rejects.toThrow(
      InvalidDocumentError,
    );
  });

  it('listFolderTree nests folders with their documents', async () => {
    const service = createService();
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    const child = await createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    await createDocument(db, { projectId, title: 'Root doc' });
    await createDocument(db, { projectId, title: 'Parent doc', folderId: parent.id });
    await createDocument(db, { projectId, title: 'Child doc', folderId: child.id });

    const tree = await service.listFolderTree(projectId);
    expect(tree).toBeDefined();
    expect(tree?.documents.map((doc) => doc.title)).toEqual(['Root doc']);
    expect(tree?.folders).toHaveLength(1);
    const parentNode = tree?.folders[0];
    expect(parentNode?.name).toBe('Parent');
    expect(parentNode?.documents.map((doc) => doc.title)).toEqual(['Parent doc']);
    expect(parentNode?.folders).toHaveLength(1);
    expect(parentNode?.folders[0]?.name).toBe('Child');
    expect(parentNode?.folders[0]?.documents.map((doc) => doc.title)).toEqual(['Child doc']);
  });

  it('listFolderTree attaches direct-only doc_count on each folder node', async () => {
    const service = createService();
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    const child = await createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    await createDocument(db, { projectId, title: 'Unfiled' });
    await createDocument(db, { projectId, title: 'Parent A', folderId: parent.id });
    await createDocument(db, { projectId, title: 'Parent B', folderId: parent.id });
    await createDocument(db, { projectId, title: 'Child doc', folderId: child.id });

    const tree = await service.listFolderTree(projectId);
    expect(tree?.folders[0]?.doc_count).toBe(2);
    // Child's document is not rolled into the parent's count (direct only).
    expect(tree?.folders[0]?.folders[0]?.doc_count).toBe(1);
  });

  it('moveMany moves valid ids and reports per-item failures without rolling back others', async () => {
    const service = createService();
    const folder = await createFolder(db, { projectId, name: 'Specs' });
    const a = await createDocument(db, { projectId, title: 'A' });
    const b = await createDocument(db, { projectId, title: 'B' });
    const missingId = '00000000-0000-4000-8000-000000009999';

    const result = await service.moveMany([a.id, missingId, b.id], folder.id);
    expect(result.moved.sort()).toEqual([a.id, b.id].sort());
    expect(result.failed).toEqual([{ document_id: missingId, error: 'Document not found' }]);

    const tree = await service.listFolderTree(projectId);
    expect(tree?.folders[0]?.documents.map((doc) => doc.title).sort()).toEqual(['A', 'B']);
  });

  it('moveMany with folder_id null files documents under Unfiled', async () => {
    const service = createService();
    const folder = await createFolder(db, { projectId, name: 'Specs' });
    const doc = await createDocument(db, { projectId, title: 'Filed', folderId: folder.id });

    const result = await service.moveMany([doc.id], null);
    expect(result.moved).toEqual([doc.id]);
    expect(result.failed).toEqual([]);
    expect((await service.get(doc.id))?.folder_id).toBeNull();
  });

  it('listByFolder returns only documents in the folder', async () => {
    const service = createService();
    const folder = await createFolder(db, { projectId, name: 'Specs' });
    await createDocument(db, { projectId, title: 'Root doc' });
    await createDocument(db, { projectId, title: 'In folder', folderId: folder.id });

    const docs = await service.listByFolder(projectId, folder.id);
    expect(docs?.map((doc) => doc.title)).toEqual(['In folder']);

    expect(await service.listByFolder(projectId, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('gets document linked to a task via edge', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Task' });
    const document = await createDocument(db, {
      projectId,
      title: 'Linked',
    });
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: document.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    expect((await service.getByTask(task.id))?.id).toBe(document.id);
    expect(await service.getByTask('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('getByTask returns the oldest edge-linked document when several link the task', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Task' });
    const first = await createDocument(db, {
      projectId,
      title: 'First',
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createDocument(db, { projectId, title: 'Second' });
    for (const doc of [first, second]) {
      await createEdge(db, {
        projectId,
        fromType: 'document',
        fromId: doc.id,
        toType: 'task',
        toId: task.id,
        label: 'documents',
      });
    }

    expect((await service.getByTask(task.id))?.id).toBe(first.id);
  });

  it('deletes document comments when deleting a document', async () => {
    const service = createService();
    const document = await createDocument(db, { projectId, title: 'Doc' });
    const comment = await createComment(db, {
      projectId,
      targetType: 'document',
      targetId: document.id,
      body: 'Note',
    });

    expect(await service.delete(document.id)).toBe(true);
    expect(await getComment(db, comment.id)).toBeUndefined();
    expect(
      await listCommentsByTarget(db, 'document', document.id, { includeResolved: true }),
    ).toHaveLength(0);
  });

  it('updates a document and bumps updated_at', async () => {
    const service = createService();
    const created = await service.create(projectId, { title: 'Before', body: 'v1' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }

    const updated = await service.update(created.id, {
      title: 'After',
      body: 'v2',
      statusLine: 'Status: review',
    });

    expect(updated?.title).toBe('After');
    expect(updated?.body).toBe(ensureHtmlBody('v2'));
    expect(updated?.status_line).toBe('Status: review');
    expect(updated?.updated_at).toBeDefined();
    if (updated?.updated_at) {
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updated_at).getTime(),
      );
    }
  });

  it('resolves wiki-links in markdown bodies into anchors and references edges', async () => {
    const service = createService();
    const target = await service.create(projectId, { title: 'Existing Doc' });
    expect(target).toBeDefined();
    if (!target) {
      return;
    }

    const source = await service.create(projectId, {
      title: 'Source',
      body: 'See [[Existing Doc|see the spec]] for details.',
    });
    expect(source).toBeDefined();
    if (!source) {
      return;
    }

    expect(source.body).toContain('<a href="/projects/');
    expect(source.body).toContain('see the spec</a>');
    expect(source.body).not.toContain('[[');
    expect(source.links).toEqual([
      expect.objectContaining({
        type: 'document',
        id: target.id,
        title: 'Existing Doc',
        label: 'references',
      }),
    ]);
  });

  it('re-saving a body with the same wiki-link does not duplicate the edge', async () => {
    const service = createService();
    const target = await service.create(projectId, { title: 'Existing Doc' });
    const source = await service.create(projectId, {
      title: 'Source',
      body: '[[Existing Doc]]',
    });
    expect(target && source).toBeTruthy();
    if (!target || !source) {
      return;
    }

    const edgesBefore = await listEdges(db, projectId);
    const references = edgesBefore.filter(
      (edge) =>
        edge.fromType === 'document' &&
        edge.fromId === source.id &&
        edge.toType === 'document' &&
        edge.toId === target.id &&
        edge.label === 'references',
    );
    expect(references).toHaveLength(1);

    await service.update(source.id, { body: '[[Existing Doc]]' });

    const edgesAfter = await listEdges(db, projectId);
    const referencesAfter = edgesAfter.filter(
      (edge) =>
        edge.fromType === 'document' &&
        edge.fromId === source.id &&
        edge.toType === 'document' &&
        edge.toId === target.id &&
        edge.label === 'references',
    );
    expect(referencesAfter).toHaveLength(1);
  });

  it('does not resolve wiki-links to documents in another project', async () => {
    const service = createService();
    const otherProjectId = (await createProject(db, { name: 'Other' })).id;
    await createDocument(db, { projectId: otherProjectId, title: 'Foreign Doc' });

    const source = await service.create(projectId, {
      title: 'Source',
      body: '[[Foreign Doc]]',
    });
    expect(source).toBeDefined();
    if (!source) {
      return;
    }

    expect(source.body).toContain('class="wikilink-unresolved"');
    expect(source.links).toEqual([]);
  });

  it('resolves wiki-link titles containing markdown characters literally', async () => {
    const service = createService();
    const target = await service.create(projectId, { title: '`get_next_task`' });
    const source = await service.create(projectId, {
      title: 'Source',
      body: 'Use [[`get_next_task`]] here.',
    });
    expect(target && source).toBeTruthy();
    if (!target || !source) {
      return;
    }

    expect(source.body).toContain('`get_next_task`</a>');
    expect(source.body).not.toContain('<code>get_next_task</code>');
    expect(source.links[0]?.id).toBe(target.id);
  });

  describe('convertBullets', () => {
    it('lands created tasks on the active goal and get_next_task sees them once released (revert-proof)', async () => {
      const service = createService();
      const taskService = createTaskService({ db, orgId });
      const complete = await createGoal(db, {
        projectId,
        objective: 'Old cycle',
        status: 'complete',
        id: '11111111-1111-4111-8111-111111111111',
      });
      await db.$client.execute({
        sql: 'UPDATE goals SET created_at = ? WHERE id = ?',
        args: [Date.now() - 20_000, complete.id],
      });
      const active = await createGoal(db, {
        projectId,
        objective: 'Current cycle',
        status: 'active',
        id: '22222222-2222-4222-8222-222222222222',
      });

      const document = await service.create(projectId, {
        title: 'Overview',
        body: '<ul><li><p>Ship the converter</p></li></ul>',
      });
      expect(document).toBeDefined();
      if (!document) {
        return;
      }

      const result = await service.convertBullets(document.id, ['Ship the converter']);
      expect(result?.created).toHaveLength(1);
      const created = result?.created[0];
      if (created === undefined) {
        throw new Error('expected created task');
      }
      expect(created.goal_id).toBe(active.id);
      expect(created.status).toBe('scope');

      // Scope is not on the frontier — release, then prove scheduler reachability.
      const released = await taskService.update(created.id, { status: 'todo' });
      expect(released?.status).toBe('todo');

      const next = await taskService.nextActionable(projectId);
      expect(next?.reason).toBe('ok');
      expect(next?.next_task?.id).toBe(created.id);
      expect(next?.next_task?.goal_id).toBe(active.id);
    });

    it('converting the same bullet twice does not silently produce two tasks (revert-proof)', async () => {
      const service = createService();
      const document = await service.create(projectId, {
        title: 'Overview',
        body: '<ul><li><p>Do the thing</p></li></ul>',
      });
      expect(document).toBeDefined();
      if (!document) {
        return;
      }

      const first = await service.convertBullets(document.id, ['Do the thing']);
      expect(first?.created).toHaveLength(1);
      expect(first?.skipped).toEqual([]);

      const second = await service.convertBullets(document.id, ['Do the thing']);
      expect(second?.created).toEqual([]);
      expect(second?.skipped).toEqual(['Do the thing']);

      const edges = await listEdges(db, projectId);
      const docTaskEdges = edges.filter(
        (edge) =>
          edge.fromType === 'document' &&
          edge.fromId === document.id &&
          edge.toType === 'task',
      );
      expect(docTaskEdges).toHaveLength(1);
    });

    it('converts multiple labels in order as scope tasks linked from the document', async () => {
      const service = createService();
      const existing = await createTask(db, {
        projectId,
        label: 'Anchor',
        status: 'todo',
        x: 0,
        y: 400,
      });
      const document = await service.create(projectId, {
        title: 'Overview',
        body: '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>',
      });
      expect(document).toBeDefined();
      if (!document) {
        return;
      }

      const result = await service.convertBullets(document.id, ['A', 'B', 'C']);
      expect(result?.created.map((task) => task.label)).toEqual(['A', 'B', 'C']);
      expect(result?.created.every((task) => task.status === 'scope')).toBe(true);
      expect(result?.created.map((task) => task.y)).toEqual([600, 800, 1000]);
      expect(result?.created.every((task) => task.x === 0)).toBe(true);

      const linked = await service.get(document.id);
      expect(linked?.links.filter((link) => link.type === 'task').map((link) => link.title)).toEqual(
        expect.arrayContaining(['A', 'B', 'C']),
      );
      expect(linked?.body).toBe(document.body);
      // Existing card untouched.
      expect((await getTask(db, existing.id))?.y).toBe(400);
    });

    it('leaves the document body unchanged when a bullet contains a wiki-link', async () => {
      const service = createService();
      const target = await service.create(projectId, { title: 'the spec' });
      expect(target).toBeDefined();
      if (!target) {
        return;
      }
      const document = await service.create(projectId, {
        title: 'Overview',
        body: `See [[the spec]] then ship.`,
      });
      expect(document).toBeDefined();
      if (!document) {
        return;
      }
      // Body is HTML with a real <a> after wiki-link resolution.
      expect(document.body).toContain(`/documents/${target.id}`);
      const bodyBefore = document.body;

      const result = await service.convertBullets(document.id, ['See the spec then ship.']);
      expect(result?.created).toHaveLength(1);
      expect(result?.created[0]?.label).toBe('See the spec then ship.');

      const after = await service.get(document.id);
      expect(after?.body).toBe(bodyBefore);
      expect(after?.body).toContain(`/documents/${target.id}`);
      expect(after?.body).toContain('>the spec</a>');
    });

    it('denies convert when the caller cannot write the document', async () => {
      const writer = createService();
      const document = await writer.create(projectId, {
        title: 'Overview',
        body: '<ul><li><p>Secret</p></li></ul>',
      });
      expect(document).toBeDefined();
      if (!document) {
        return;
      }

      const reader = createService({
        permission: {
          task: ['create', 'read', 'update', 'delete'],
          document: ['read'],
          edge: ['create', 'read'],
          goal: ['read'],
          comment: ['read'],
          agent_run: ['read'],
          project: [],
          organization: [],
          member: [],
          invitation: [],
          team: [],
          ac: [],
          apiKey: [],
        },
      });

      await expect(reader.convertBullets(document.id, ['Secret'])).rejects.toThrow(
        PermissionDeniedError,
      );
      expect(await listEdges(db, projectId)).toHaveLength(0);
    });

    it('treats a foreign-org document id like an unknown one', async () => {
      const service = createService();
      const document = await service.create(projectId, { title: 'Ours' });
      expect(document).toBeDefined();
      if (!document) {
        return;
      }

      const foreign = createDocumentService({
        db,
        orgId: '00000000-0000-4000-8000-00000000ffff',
        taskService: createTaskService({
          db,
          orgId: '00000000-0000-4000-8000-00000000ffff',
        }),
      });
      expect(await foreign.convertBullets(document.id, ['Leak'])).toBeUndefined();
      expect(await listEdges(db, projectId)).toHaveLength(0);
    });
  });
});

describe.each([
  { mode: ':memory:', dbPath: ':memory:' },
  {
    mode: 'file:',
    dbPath: () => join(tmpdir(), `plandesk-doc-rev-${randomUUID()}.db`),
  },
])('document revision capture ($mode)', ({ dbPath }) => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  function createService(actor?: Parameters<typeof createDocumentService>[0]['actor']) {
    return createDocumentService({ db, orgId, ...(actor !== undefined ? { actor } : {}) });
  }

  beforeEach(async () => {
    const path = typeof dbPath === 'function' ? dbPath() : dbPath;
    db = await createDb(path);
    await migrate(db);
    await db.$client.execute('DELETE FROM revisions');
    await db.$client.execute('DELETE FROM comments');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('UPDATE folders SET parent_folder_id = NULL');
    await db.$client.execute('DELETE FROM folders');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    const project = await createProject(db, { name: 'Doc revisions' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('records one revision with the prior body when body changes', async () => {
    const service = createService();
    const document = await createDocument(db, { projectId, title: 'Spec', body: 'before' });

    await service.update(document.id, { body: 'after' });

    const revisions = await listRevisionsByTarget(db, projectId, 'document', document.id);
    expect(revisions).toHaveLength(1);
    expect(JSON.parse(revisions[0]?.snapshot ?? '{}')).toEqual({
      title: 'Spec',
      body: 'before',
      statusLine: null,
    });
    expect(JSON.parse(revisions[0]?.changedFields ?? '[]')).toEqual(['body']);
    expect((await getDocument(db, document.id))?.body).toBe(ensureHtmlBody('after'));
  });

  it('records no revision when a versioned field is set to an identical value', async () => {
    const service = createService();
    const document = await createDocument(db, { projectId, title: 'Same', body: 'unchanged' });

    await service.update(document.id, { title: 'Same' });

    expect(await listRevisionsByTarget(db, projectId, 'document', document.id)).toHaveLength(0);
  });

  it('records no revision when only excluded fields change', async () => {
    const service = createService();
    const parent = await createDocument(db, { projectId, title: 'Parent' });
    const folder = await createFolder(db, { projectId, name: 'Specs' });
    const document = await createDocument(db, { projectId, title: 'Child', parentId: null });

    await service.update(document.id, { parentId: parent.id, folderId: folder.id });

    expect(await listRevisionsByTarget(db, projectId, 'document', document.id)).toHaveLength(0);
  });

  it('records author from human, agent, and system actors', async () => {
    const document = await createDocument(db, { projectId, title: 'Actor', body: 'v0' });

    const human = createService({ kind: 'human', userId: 'user-1' });
    await human.update(document.id, { body: 'v1' });
    let revisions = await listRevisionsByTarget(db, projectId, 'document', document.id);
    expect(revisions[revisions.length - 1]?.author).toBe('human:user-1');

    const agent = createService({ kind: 'agent', runId: 'run-42' });
    await agent.update(document.id, { body: 'v2' });
    revisions = await listRevisionsByTarget(db, projectId, 'document', document.id);
    expect(revisions[revisions.length - 1]?.author).toBe('agent:run-42');

    const system = createService({ kind: 'system' });
    await system.update(document.id, { body: 'v3' });
    revisions = await listRevisionsByTarget(db, projectId, 'document', document.id);
    expect(revisions[revisions.length - 1]?.author).toBe('system');
  });

  it('concurrent versioned updates race: one winner, one conflict, no orphan revision', async () => {
    const raceDbPath = join(tmpdir(), `plandesk-doc-race-${randomUUID()}.db`);
    const dbA = await createDb(raceDbPath);
    const dbB = await createDb(raceDbPath);
    await migrate(dbA);
    const project = await createProject(dbA, { name: 'Race' });
    const raceProjectId = project.id;
    const raceOrgId = project.orgId;
    const document = await createDocument(dbA, {
      projectId: raceProjectId,
      title: 'Start',
      body: 'v0',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const serviceA = createDocumentService({ db: dbA, orgId: raceOrgId });
    const serviceB = createDocumentService({ db: dbB, orgId: raceOrgId });
    const [a, b] = await Promise.all([
      serviceA.update(document.id, { title: 'Winner A', body: 'a' }),
      serviceB.update(document.id, { title: 'Winner B', body: 'b' }),
    ]);

    const successes = [a, b].filter((row) => row !== undefined);
    const failures = [a, b].filter((row) => row === undefined);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const revisions = await listRevisionsByTarget(dbA, raceProjectId, 'document', document.id);
    expect(revisions).toHaveLength(1);
    expect(JSON.parse(revisions[0]?.snapshot ?? '{}')).toEqual({
      title: 'Start',
      body: 'v0',
      statusLine: null,
    });

    const stored = await getDocument(dbA, document.id);
    expect(stored?.title).toBe(successes[0]?.title);
    expect(stored?.body).toBe(successes[0]?.body);
  });
});
