import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import {
  createDocument,
  getDocument,
  getDocumentByTask,
  listDocuments,
  updateDocument,
} from './documents.js';

describe('documents repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Docs' })).id;
  });

  it('creates and retrieves a document', async () => {
    const task = await createTask(db, { projectId, label: 'Linked' });
    const created = await createDocument(db, {
      projectId,
      title: 'Spec',
      body: '# Overview',
      statusLine: 'Status: draft',
      linkedTaskId: task.id,
    });
    const fetched = await getDocument(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.body).toBe('# Overview');
    expect(fetched?.statusLine).toBe('Status: draft');
    expect(fetched?.linkedTaskId).toBe(task.id);
  });

  it('returns undefined for a missing document', async () => {
    expect(await getDocument(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists documents for a project', async () => {
    await createDocument(db, { projectId, title: 'One' });
    await createDocument(db, { projectId, title: 'Two' });
    expect(await listDocuments(db, projectId)).toHaveLength(2);
  });

  it('gets document by linked task', async () => {
    const task = await createTask(db, { projectId, label: 'Task' });
    const doc = await createDocument(db, {
      projectId,
      title: 'Linked doc',
      linkedTaskId: task.id,
    });
    expect((await getDocumentByTask(db, task.id))?.id).toBe(doc.id);
    expect(await getDocumentByTask(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('supports parent_id nesting', async () => {
    const parent = await createDocument(db, { projectId, title: 'Parent' });
    const child = await createDocument(db, {
      projectId,
      title: 'Child',
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
  });

  it('updates a document and bumps updated_at', async () => {
    const created = await createDocument(db, { projectId, title: 'Before', body: 'v1' });
    const updated = await updateDocument(db, created.id, {
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
