import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import {
  createDocument,
  getDocument,
  getDocumentByTask,
  listDocuments,
  updateDocument,
} from './documents.js';

describe('documents repository', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Docs' }).id;
  });

  it('creates and retrieves a document', () => {
    const task = createTask(db, { projectId, label: 'Linked' });
    const created = createDocument(db, {
      projectId,
      title: 'Spec',
      body: '# Overview',
      statusLine: 'Status: draft',
      linkedTaskId: task.id,
    });
    const fetched = getDocument(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.body).toBe('# Overview');
    expect(fetched?.statusLine).toBe('Status: draft');
    expect(fetched?.linkedTaskId).toBe(task.id);
  });

  it('returns undefined for a missing document', () => {
    expect(getDocument(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists documents for a project', () => {
    createDocument(db, { projectId, title: 'One' });
    createDocument(db, { projectId, title: 'Two' });
    expect(listDocuments(db, projectId)).toHaveLength(2);
  });

  it('gets document by linked task', () => {
    const task = createTask(db, { projectId, label: 'Task' });
    const doc = createDocument(db, {
      projectId,
      title: 'Linked doc',
      linkedTaskId: task.id,
    });
    expect(getDocumentByTask(db, task.id)?.id).toBe(doc.id);
    expect(getDocumentByTask(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('supports parent_id nesting', () => {
    const parent = createDocument(db, { projectId, title: 'Parent' });
    const child = createDocument(db, {
      projectId,
      title: 'Child',
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
  });

  it('updates a document and bumps updated_at', () => {
    const created = createDocument(db, { projectId, title: 'Before', body: 'v1' });
    const updated = updateDocument(db, created.id, {
      title: 'After',
      body: 'v2',
      statusLine: 'Status: review',
    });
    expect(updated?.title).toBe('After');
    expect(updated?.body).toBe('v2');
    expect(updated?.statusLine).toBe('Status: review');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });
});
