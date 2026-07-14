import { beforeEach, describe, expect, it } from 'vitest';
import {
  createComment,
  createDb,
  createDocument,
  createFolder,
  createProject,
  getComment,
  listCommentsByTarget,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createEventBus } from '../events.js';
import { createDocumentService, InvalidDocumentError } from './documents.js';

describe('documentService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createDocumentService({ db, eventBus });
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
    projectId = (await createProject(db, { name: 'Docs' })).id;
  });

  it('creates a document with structured content', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Task' });
    const document = await service.create(projectId, {
      title: 'Spec',
      body: '# Overview',
      statusLine: 'Status: draft',
      linkedTaskId: task.id,
    });

    expect(document).toMatchObject({
      title: 'Spec',
      body: '# Overview',
      status_line: 'Status: draft',
      linked_task_id: task.id,
      project_id: projectId,
    });
    expect(document?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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

  it('rejects cross-project task link on create', async () => {
    const service = createService();
    const otherProjectId = (await createProject(db, { name: 'Other' })).id;
    const foreignTask = await createTask(db, { projectId: otherProjectId, label: 'Foreign' });

    await expect(service.create(projectId, {
        title: 'Bad link',
        linkedTaskId: foreignTask.id,
      }),).rejects.toThrow(InvalidDocumentError);
  });

  it('rejects cross-project task link on update', async () => {
    const service = createService();
    const document = await createDocument(db, { projectId, title: 'Doc' });
    const otherProjectId = (await createProject(db, { name: 'Other' })).id;
    const foreignTask = await createTask(db, { projectId: otherProjectId, label: 'Foreign' });

    await expect(service.update(document.id, {
        linkedTaskId: foreignTask.id,
      }),).rejects.toThrow(InvalidDocumentError);
  });

  it('gets document linked to a task', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Task' });
    const document = await createDocument(db, {
      projectId,
      title: 'Linked',
      linkedTaskId: task.id,
    });

    expect((await service.getByTask(task.id))?.id).toBe(document.id);
    expect(await service.getByTask('00000000-0000-4000-8000-000000009999')).toBeUndefined();
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
