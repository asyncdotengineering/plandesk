import { beforeEach, describe, expect, it } from 'vitest';
import {
  createComment,
  createDb,
  createDocument,
  createEdge,
  createFolder,
  createProjectInDefaultOrg as createProject,
  getComment,
  listCommentsByTarget,
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
          edge_id: expect.any(String),
        },
      ],
      backlinks: [],
    });
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
    expect(a?.links).toEqual([
      {
        type: 'document',
        id: docB.id,
        title: 'Doc B',
        label: 'references',
        edge_id: expect.any(String),
      },
    ]);
    expect(b?.backlinks).toEqual([
      {
        type: 'document',
        id: docA.id,
        title: 'Doc A',
        label: 'references',
        edge_id: a!.links[0]!.edge_id,
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
