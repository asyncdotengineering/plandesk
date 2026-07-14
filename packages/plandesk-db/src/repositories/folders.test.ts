import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createDocument, getDocument, listDocuments } from './documents.js';
import {
  clearFolderParentRefsByProject,
  createFolder,
  deleteFolder,
  deleteFoldersByProjectId,
  getFolder,
  getFolderByProjectAndId,
  listFolders,
  moveDocumentsToFolder,
  reparentChildFolders,
  updateFolder,
} from './folders.js';

describe('folders repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Folders' })).id;
  });

  it('creates and retrieves a folder', async () => {
    const created = await createFolder(db, { projectId, name: 'Specs' });
    const fetched = await getFolder(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.name).toBe('Specs');
    expect(fetched?.parentFolderId).toBeNull();
  });

  it('creates a nested folder under a parent', async () => {
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    const child = await createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    expect(child.parentFolderId).toBe(parent.id);
  });

  it('returns undefined for a missing folder', async () => {
    expect(await getFolder(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists folders for a project only', async () => {
    await createFolder(db, { projectId, name: 'One' });
    await createFolder(db, { projectId, name: 'Two' });
    const other = (await createProject(db, { name: 'Other' })).id;
    await createFolder(db, { projectId: other, name: 'Elsewhere' });
    expect(await listFolders(db, projectId)).toHaveLength(2);
  });

  it('scopes getFolderByProjectAndId to the project', async () => {
    const folder = await createFolder(db, { projectId, name: 'Scoped' });
    expect((await getFolderByProjectAndId(db, projectId, folder.id))?.id).toBe(folder.id);
    const other = (await createProject(db, { name: 'Other' })).id;
    expect(await getFolderByProjectAndId(db, other, folder.id)).toBeUndefined();
  });

  it('renames and re-parents a folder and bumps updated_at', async () => {
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    const created = await createFolder(db, { projectId, name: 'Before' });
    const updated = await updateFolder(db, created.id, { name: 'After', parentFolderId: parent.id });
    expect(updated?.name).toBe('After');
    expect(updated?.parentFolderId).toBe(parent.id);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    const moved = await updateFolder(db, created.id, { parentFolderId: null });
    expect(moved?.parentFolderId).toBeNull();
  });

  it('deletes a folder', async () => {
    const created = await createFolder(db, { projectId, name: 'Doomed' });
    expect(await deleteFolder(db, created.id)).toBe(true);
    expect(await getFolder(db, created.id)).toBeUndefined();
    expect(await deleteFolder(db, created.id)).toBe(false);
  });

  it('assigns documents to a folder and filters listDocuments by folderId', async () => {
    const folder = await createFolder(db, { projectId, name: 'Docs' });
    const inFolder = await createDocument(db, { projectId, title: 'Inside', folderId: folder.id });
    await createDocument(db, { projectId, title: 'Root doc' });

    expect((await getDocument(db, inFolder.id))?.folderId).toBe(folder.id);
    const filtered = await listDocuments(db, projectId, { folderId: folder.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(inFolder.id);
    expect(await listDocuments(db, projectId)).toHaveLength(2);
  });

  it('reparentChildFolders moves children to a new parent or root', async () => {
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    const mid = await createFolder(db, { projectId, name: 'Mid', parentFolderId: parent.id });
    const child = await createFolder(db, { projectId, name: 'Child', parentFolderId: mid.id });

    expect(await reparentChildFolders(db, mid.id, parent.id)).toBe(1);
    expect((await getFolder(db, child.id))?.parentFolderId).toBe(parent.id);

    expect(await reparentChildFolders(db, parent.id, null)).toBe(2);
    expect((await getFolder(db, child.id))?.parentFolderId).toBeNull();
    expect((await getFolder(db, mid.id))?.parentFolderId).toBeNull();
  });

  it('moveDocumentsToFolder re-homes documents in a folder', async () => {
    const from = await createFolder(db, { projectId, name: 'From' });
    const to = await createFolder(db, { projectId, name: 'To' });
    const doc = await createDocument(db, { projectId, title: 'Doc', folderId: from.id });

    expect(await moveDocumentsToFolder(db, from.id, to.id)).toBe(1);
    expect((await getDocument(db, doc.id))?.folderId).toBe(to.id);

    expect(await moveDocumentsToFolder(db, to.id, null)).toBe(1);
    expect((await getDocument(db, doc.id))?.folderId).toBeNull();
  });

  it('deletes all folders for a project after clearing parent refs', async () => {
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    await createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    expect(await clearFolderParentRefsByProject(db, projectId)).toBe(2);
    expect(await deleteFoldersByProjectId(db, projectId)).toBe(2);
    expect(await listFolders(db, projectId)).toHaveLength(0);
  });
});
