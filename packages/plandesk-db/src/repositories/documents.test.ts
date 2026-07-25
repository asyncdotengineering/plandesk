import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import { createEdge } from './edges.js';
import {
  createDocument,
  getDocument,
  getDocumentByTask,
  listDocuments,
  listDocumentsLinkedToTask,
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
    expect((await getDocumentByTask(db, projectId, task.id))?.id).toBe(doc.id);
    expect(
      await getDocumentByTask(db, projectId, '00000000-0000-4000-8000-000000009999'),
    ).toBeUndefined();
  });

  it('lists and resolves documents linked by edge as well as linked_task_id', async () => {
    const task = await createTask(db, { projectId, label: 'Task' });
    const legacy = await createDocument(db, {
      projectId,
      title: 'Legacy doc',
      linkedTaskId: task.id,
    });
    const edgeOnly = await createDocument(db, { projectId, title: 'Edge-only doc' });
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: edgeOnly.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    const linked = await listDocumentsLinkedToTask(db, projectId, task.id);
    expect(linked.map((d) => d.id).sort()).toEqual([legacy.id, edgeOnly.id].sort());

    // Singular lookup prefers the legacy primary over an edge-only peer.
    expect((await getDocumentByTask(db, projectId, task.id))?.id).toBe(legacy.id);
  });

  it('getDocumentByTask returns the oldest edge-linked doc when no legacy primary', async () => {
    const task = await createTask(db, { projectId, label: 'Task' });
    const first = await createDocument(db, { projectId, title: 'First edge' });
    const second = await createDocument(db, { projectId, title: 'Second edge' });
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: first.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: second.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    expect((await getDocumentByTask(db, projectId, task.id))?.id).toBe(first.id);
  });

  it('listDocumentsLinkedToTask stays project-scoped', async () => {
    const task = await createTask(db, { projectId, label: 'Task' });
    const inProject = await createDocument(db, { projectId, title: 'In project' });
    await createEdge(db, {
      projectId,
      fromType: 'document',
      fromId: inProject.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    const other = await createProject(db, { name: 'Other' });
    const foreignDoc = await createDocument(db, { projectId: other.id, title: 'Foreign' });
    // Even if an edge id were mis-pointed, project filter on re-fetch drops it.
    await createEdge(db, {
      projectId: other.id,
      fromType: 'document',
      fromId: foreignDoc.id,
      toType: 'task',
      toId: task.id,
      label: 'documents',
    });

    const linked = await listDocumentsLinkedToTask(db, projectId, task.id);
    expect(linked.map((d) => d.id)).toEqual([inProject.id]);
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
