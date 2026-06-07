import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createDocument, createProject, createTask, migrate } from '@plandesk/db';
import { createDocumentService, InvalidDocumentError } from './documents.js';

describe('documentService', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Docs' }).id;
  });

  it('creates a document with structured content', () => {
    const service = createDocumentService({ db });
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
    const service = createDocumentService({ db });
    const parent = createDocument(db, { projectId, title: 'Parent' });
    createDocument(db, { projectId, title: 'Child', parentId: parent.id });

    const tree = service.listTree(projectId);
    expect(tree).toHaveLength(1);
    expect(tree?.[0]?.title).toBe('Parent');
    expect(tree?.[0]?.children).toHaveLength(1);
    expect(tree?.[0]?.children[0]?.title).toBe('Child');
    expect(tree?.[0]?.children[0]?.parent_id).toBe(parent.id);
  });

  it('rejects cross-project task link on create', () => {
    const service = createDocumentService({ db });
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
    const service = createDocumentService({ db });
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
    const service = createDocumentService({ db });
    const task = createTask(db, { projectId, label: 'Task' });
    const document = createDocument(db, {
      projectId,
      title: 'Linked',
      linkedTaskId: task.id,
    });

    expect(service.getByTask(task.id)?.id).toBe(document.id);
    expect(service.getByTask('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('updates a document and bumps updated_at', () => {
    const service = createDocumentService({ db });
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
