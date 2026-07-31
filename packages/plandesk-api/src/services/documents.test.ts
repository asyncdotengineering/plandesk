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
  createProjectInDefaultOrg as createProject,
  getComment,
  getDocument,
  listCommentsByTarget,
  listRevisionsByTarget,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createDocumentService, InvalidDocumentError } from './documents.js';

describe('documentService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  let projectId = '';
  let orgId = '';

  function createService() {
    return createDocumentService({ db, orgId });
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
      body: '# Overview',
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
    expect(updated?.body).toBe('v2');
    expect(updated?.status_line).toBe('Status: review');
    expect(updated?.updated_at).toBeDefined();
    if (updated?.updated_at) {
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updated_at).getTime(),
      );
    }
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
    expect((await getDocument(db, document.id))?.body).toBe('after');
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
