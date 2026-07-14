import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, createProject, getDocument, getFolder, migrate , type Db} from '@plandesk/db';
import { createDocumentService } from './documents.js';
import { createFolderService, InvalidFolderError } from './folders.js';

describe('folderService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
    let projectId = '';

  function createService() {
    return createFolderService({ db });
  }

  function createDocService() {
    return createDocumentService({ db });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('UPDATE folders SET parent_folder_id = NULL');
    await db.$client.execute('DELETE FROM folders');
    await db.$client.execute('DELETE FROM projects');
    projectId = (await createProject(db, { name: 'Folders' })).id;
  });

  it('creates a folder', async () => {
    const folder = await createService().create(projectId, { name: 'Specs' });
    expect(folder?.name).toBe('Specs');
    expect(folder?.parent_folder_id).toBeNull();
    expect(await getFolder(db, folder!.id)).toBeDefined();
  });

  it('updates and deletes a folder', async () => {
    const service = createService();
    const folder = await service.create(projectId, { name: 'Before' });
    expect(folder).toBeDefined();
    if (!folder) {
      return;
    }

    const updated = await service.update(folder.id, { name: 'After' });
    expect(updated?.name).toBe('After');
    expect(await service.delete(folder.id)).toBe(true);
    expect(await getFolder(db, folder.id)).toBeUndefined();
  });

  it('returns undefined when the project does not exist', async () => {
    expect(
      await createService().create('00000000-0000-4000-8000-000000009999', { name: 'Orphan' }),
    ).toBeUndefined();
  });

  it('throws InvalidFolderError on blank name', async () => {
    const service = createService();
    await expect(service.create(projectId, { name: '  ' })).rejects.toThrow(InvalidFolderError);
    const folder = await service.create(projectId, { name: 'Valid' });
    expect(folder).toBeDefined();
    if (!folder) {
      return;
    }
    await expect(service.update(folder.id, { name: '' })).rejects.toThrow(InvalidFolderError);
  });

  it('rejects a parent folder from another project', async () => {
    const service = createService();
    const otherProject = (await createProject(db, { name: 'Other' })).id;
    const foreign = await service.create(otherProject, { name: 'Foreign' });
    expect(foreign).toBeDefined();
    if (!foreign) {
      return;
    }
    await expect(service.create(projectId, { name: 'Child', parentFolderId: foreign.id })).rejects.toThrow(
      InvalidFolderError,
    );
  });

  it('nests folders and rejects self-parenting', async () => {
    const service = createService();
    const parent = await service.create(projectId, { name: 'Parent' });
    const child = await service.create(projectId, { name: 'Child', parentFolderId: parent?.id });
    expect(child?.parent_folder_id).toBe(parent?.id);
    if (!child) {
      return;
    }
    await expect(service.update(child.id, { parentFolderId: child.id })).rejects.toThrow(
      InvalidFolderError,
    );
  });

  it('rejects re-parenting that would create a cycle', async () => {
    const service = createService();
    const a = await service.create(projectId, { name: 'A' });
    const b = await service.create(projectId, { name: 'B', parentFolderId: a?.id });
    const c = await service.create(projectId, { name: 'C', parentFolderId: b?.id });
    expect(a && b && c).toBeTruthy();
    if (!a || !b || !c) {
      return;
    }

    await expect(service.update(a.id, { parentFolderId: c.id })).rejects.toThrow(InvalidFolderError);
    await expect(service.update(a.id, { parentFolderId: b.id })).rejects.toThrow(InvalidFolderError);
    // a sibling move stays legal
    const moved = await service.update(c.id, { parentFolderId: a.id });
    expect(moved?.parent_folder_id).toBe(a.id);
  });

  it('re-parents to root with null', async () => {
    const service = createService();
    const parent = await service.create(projectId, { name: 'Parent' });
    const child = await service.create(projectId, { name: 'Child', parentFolderId: parent?.id });
    if (!child) {
      return;
    }
    const moved = await service.update(child.id, { parentFolderId: null });
    expect(moved?.parent_folder_id).toBeNull();
  });

  it('delete moves child folders and documents to the parent instead of orphaning', async () => {
    const service = createService();
    const docService = createDocService();
    const root = await service.create(projectId, { name: 'Root' });
    const mid = await service.create(projectId, { name: 'Mid', parentFolderId: root?.id });
    const leaf = await service.create(projectId, { name: 'Leaf', parentFolderId: mid?.id });
    const doc = await docService.create(projectId, { title: 'In mid', folderId: mid?.id });
    expect(root && mid && leaf && doc).toBeTruthy();
    if (!root || !mid || !leaf || !doc) {
      return;
    }

    expect(await service.delete(mid.id)).toBe(true);
    expect(await getFolder(db, mid.id)).toBeUndefined();
    expect((await getFolder(db, leaf.id))?.parentFolderId).toBe(root.id);
    expect((await getDocument(db, doc.id))?.folderId).toBe(root.id);
  });

  it('delete of a root folder moves children and documents to root', async () => {
    const service = createService();
    const docService = createDocService();
    const root = await service.create(projectId, { name: 'Root' });
    const child = await service.create(projectId, { name: 'Child', parentFolderId: root?.id });
    const doc = await docService.create(projectId, { title: 'In root folder', folderId: root?.id });
    if (!root || !child || !doc) {
      return;
    }

    expect(await service.delete(root.id)).toBe(true);
    expect((await getFolder(db, child.id))?.parentFolderId).toBeNull();
    expect((await getDocument(db, doc.id))?.folderId).toBeNull();
  });

  it('delete returns false for a missing folder', async () => {
    expect(await createService().delete('00000000-0000-4000-8000-000000009999')).toBe(false);
  });
});
