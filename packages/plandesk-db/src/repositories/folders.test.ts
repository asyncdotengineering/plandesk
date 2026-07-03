import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
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
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM folders');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Folders' }).id;
  });

  it('creates and retrieves a folder', () => {
    const created = createFolder(db, { projectId, name: 'Specs' });
    const fetched = getFolder(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.name).toBe('Specs');
    expect(fetched?.parentFolderId).toBeNull();
  });

  it('creates a nested folder under a parent', () => {
    const parent = createFolder(db, { projectId, name: 'Parent' });
    const child = createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    expect(child.parentFolderId).toBe(parent.id);
  });

  it('returns undefined for a missing folder', () => {
    expect(getFolder(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists folders for a project only', () => {
    createFolder(db, { projectId, name: 'One' });
    createFolder(db, { projectId, name: 'Two' });
    const other = createProject(db, { name: 'Other' }).id;
    createFolder(db, { projectId: other, name: 'Elsewhere' });
    expect(listFolders(db, projectId)).toHaveLength(2);
  });

  it('scopes getFolderByProjectAndId to the project', () => {
    const folder = createFolder(db, { projectId, name: 'Scoped' });
    expect(getFolderByProjectAndId(db, projectId, folder.id)?.id).toBe(folder.id);
    const other = createProject(db, { name: 'Other' }).id;
    expect(getFolderByProjectAndId(db, other, folder.id)).toBeUndefined();
  });

  it('renames and re-parents a folder and bumps updated_at', () => {
    const parent = createFolder(db, { projectId, name: 'Parent' });
    const created = createFolder(db, { projectId, name: 'Before' });
    const updated = updateFolder(db, created.id, { name: 'After', parentFolderId: parent.id });
    expect(updated?.name).toBe('After');
    expect(updated?.parentFolderId).toBe(parent.id);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    const moved = updateFolder(db, created.id, { parentFolderId: null });
    expect(moved?.parentFolderId).toBeNull();
  });

  it('deletes a folder', () => {
    const created = createFolder(db, { projectId, name: 'Doomed' });
    expect(deleteFolder(db, created.id)).toBe(true);
    expect(getFolder(db, created.id)).toBeUndefined();
    expect(deleteFolder(db, created.id)).toBe(false);
  });

  it('assigns documents to a folder and filters listDocuments by folderId', () => {
    const folder = createFolder(db, { projectId, name: 'Docs' });
    const inFolder = createDocument(db, { projectId, title: 'Inside', folderId: folder.id });
    createDocument(db, { projectId, title: 'Root doc' });

    expect(getDocument(db, inFolder.id)?.folderId).toBe(folder.id);
    const filtered = listDocuments(db, projectId, { folderId: folder.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(inFolder.id);
    expect(listDocuments(db, projectId)).toHaveLength(2);
  });

  it('reparentChildFolders moves children to a new parent or root', () => {
    const parent = createFolder(db, { projectId, name: 'Parent' });
    const mid = createFolder(db, { projectId, name: 'Mid', parentFolderId: parent.id });
    const child = createFolder(db, { projectId, name: 'Child', parentFolderId: mid.id });

    expect(reparentChildFolders(db, mid.id, parent.id)).toBe(1);
    expect(getFolder(db, child.id)?.parentFolderId).toBe(parent.id);

    expect(reparentChildFolders(db, parent.id, null)).toBe(2);
    expect(getFolder(db, child.id)?.parentFolderId).toBeNull();
    expect(getFolder(db, mid.id)?.parentFolderId).toBeNull();
  });

  it('moveDocumentsToFolder re-homes documents in a folder', () => {
    const from = createFolder(db, { projectId, name: 'From' });
    const to = createFolder(db, { projectId, name: 'To' });
    const doc = createDocument(db, { projectId, title: 'Doc', folderId: from.id });

    expect(moveDocumentsToFolder(db, from.id, to.id)).toBe(1);
    expect(getDocument(db, doc.id)?.folderId).toBe(to.id);

    expect(moveDocumentsToFolder(db, to.id, null)).toBe(1);
    expect(getDocument(db, doc.id)?.folderId).toBeNull();
  });

  it('deletes all folders for a project after clearing parent refs', () => {
    const parent = createFolder(db, { projectId, name: 'Parent' });
    createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    expect(clearFolderParentRefsByProject(db, projectId)).toBe(2);
    expect(deleteFoldersByProjectId(db, projectId)).toBe(2);
    expect(listFolders(db, projectId)).toHaveLength(0);
  });
});
