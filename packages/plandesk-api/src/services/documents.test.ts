import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createDocumentComment,
  createFolder,
  createProject,
  getDocumentComment,
  listCommentsByDocument,
  migrate,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createEventBus } from '../events.js';
import { createDocumentService, InvalidDocumentError } from './documents.js';

describe('documentService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createDocumentService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM document_comments');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('UPDATE folders SET parent_folder_id = NULL');
    db.$client.exec('DELETE FROM folders');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Docs' }).id;
  });

  it('creates a document with structured content', () => {
    const service = createService();
    const task = createTask(db, { projectId, label: 'Task' });
    const document = service.create(projectId, {
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

  it('returns nested document tree', () => {
    const service = createService();
    const parent = createDocument(db, { projectId, title: 'Parent' });
    createDocument(db, { projectId, title: 'Child', parentId: parent.id });

    const tree = service.listTree(projectId);
    expect(tree).toHaveLength(1);
    expect(tree?.[0]?.title).toBe('Parent');
    expect(tree?.[0]?.children).toHaveLength(1);
    expect(tree?.[0]?.children[0]?.title).toBe('Child');
    expect(tree?.[0]?.children[0]?.parent_id).toBe(parent.id);
  });

  it('creates a document inside a folder and moves it via update', () => {
    const service = createService();
    const folder = createFolder(db, { projectId, name: 'Specs' });
    const document = service.create(projectId, { title: 'In folder', folderId: folder.id });
    expect(document?.folder_id).toBe(folder.id);
    if (!document) {
      return;
    }

    const moved = service.update(document.id, { folderId: null });
    expect(moved?.folder_id).toBeNull();
  });

  it('rejects a folder from another project on create and update', () => {
    const service = createService();
    const otherProjectId = createProject(db, { name: 'Other' }).id;
    const foreignFolder = createFolder(db, { projectId: otherProjectId, name: 'Foreign' });

    expect(() => service.create(projectId, { title: 'Doc', folderId: foreignFolder.id })).toThrow(
      InvalidDocumentError,
    );

    const document = service.create(projectId, { title: 'Doc' });
    expect(document).toBeDefined();
    if (!document) {
      return;
    }
    expect(() => service.update(document.id, { folderId: foreignFolder.id })).toThrow(
      InvalidDocumentError,
    );
  });

  it('listFolderTree nests folders with their documents', () => {
    const service = createService();
    const parent = createFolder(db, { projectId, name: 'Parent' });
    const child = createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    createDocument(db, { projectId, title: 'Root doc' });
    createDocument(db, { projectId, title: 'Parent doc', folderId: parent.id });
    createDocument(db, { projectId, title: 'Child doc', folderId: child.id });

    const tree = service.listFolderTree(projectId);
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

  it('listByFolder returns only documents in the folder', () => {
    const service = createService();
    const folder = createFolder(db, { projectId, name: 'Specs' });
    createDocument(db, { projectId, title: 'Root doc' });
    createDocument(db, { projectId, title: 'In folder', folderId: folder.id });

    const docs = service.listByFolder(projectId, folder.id);
    expect(docs?.map((doc) => doc.title)).toEqual(['In folder']);

    expect(
      service.listByFolder(projectId, '00000000-0000-4000-8000-000000009999'),
    ).toBeUndefined();
  });

  it('rejects cross-project task link on create', () => {
    const service = createService();
    const otherProjectId = createProject(db, { name: 'Other' }).id;
    const foreignTask = createTask(db, { projectId: otherProjectId, label: 'Foreign' });

    expect(() =>
      service.create(projectId, {
        title: 'Bad link',
        linkedTaskId: foreignTask.id,
      }),
    ).toThrow(InvalidDocumentError);
  });

  it('rejects cross-project task link on update', () => {
    const service = createService();
    const document = createDocument(db, { projectId, title: 'Doc' });
    const otherProjectId = createProject(db, { name: 'Other' }).id;
    const foreignTask = createTask(db, { projectId: otherProjectId, label: 'Foreign' });

    expect(() =>
      service.update(document.id, {
        linkedTaskId: foreignTask.id,
      }),
    ).toThrow(InvalidDocumentError);
  });

  it('gets document linked to a task', () => {
    const service = createService();
    const task = createTask(db, { projectId, label: 'Task' });
    const document = createDocument(db, {
      projectId,
      title: 'Linked',
      linkedTaskId: task.id,
    });

    expect(service.getByTask(task.id)?.id).toBe(document.id);
    expect(service.getByTask('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('deletes document comments when deleting a document', () => {
    const service = createService();
    const document = createDocument(db, { projectId, title: 'Doc' });
    const comment = createDocumentComment(db, { documentId: document.id, body: 'Note' });

    expect(service.delete(document.id)).toBe(true);
    expect(getDocumentComment(db, comment.id)).toBeUndefined();
    expect(listCommentsByDocument(db, document.id, { includeResolved: true })).toHaveLength(0);
  });

  it('updates a document and bumps updated_at', () => {
    const service = createService();
    const created = service.create(projectId, { title: 'Before', body: 'v1' });
    expect(created).toBeDefined();
    if (!created) {
      return;
    }

    const updated = service.update(created.id, {
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
