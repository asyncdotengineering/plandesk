import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createFolder,
  createProjectInDefaultOrg as createProject,
  createDocument,
  getArtifact,
  migrate,
  type Db,
} from '@plandesk/db';
import { createServices } from '../services/index.js';

type Services = ReturnType<typeof createServices>;

let db: Db;
let services: Services;
let projectId: string;

beforeEach(async () => {
  db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, { name: 'Filed artifacts' });
  projectId = project.id;
  services = createServices({ db, orgId: project.orgId });
});

describe('artifacts in the document tree', () => {
  it('files an artifact in a folder and reads it back there', async () => {
    const folder = await createFolder(db, { projectId, name: 'Reports' });

    const created = await services.artifactService.create(projectId, {
      title: 'Q3 Report',
      kind: 'html',
      content: '<main>revenue</main>',
      folderId: folder.id,
    });

    expect(created?.folder_id).toBe(folder.id);
    expect((await services.artifactService.get(created?.id ?? ''))?.folder_id).toBe(folder.id);
  });

  it('leaves an artifact unfiled when no folder is given', async () => {
    const created = await services.artifactService.create(projectId, { title: 'Loose note' });
    expect(created?.folder_id).toBeNull();
  });

  it('moves an artifact between folders, and back to unfiled with null', async () => {
    const first = await createFolder(db, { projectId, name: 'Drafts' });
    const second = await createFolder(db, { projectId, name: 'Final' });
    const created = await services.artifactService.create(projectId, {
      title: 'Moving',
      folderId: first.id,
    });
    const id = created?.id ?? '';

    expect((await services.artifactService.update(id, { folderId: second.id }))?.folder_id).toBe(
      second.id,
    );
    expect((await services.artifactService.update(id, { folderId: null }))?.folder_id).toBeNull();
  });

  it('refuses a folder from another project rather than storing it', async () => {
    const other = await createProject(db, { name: 'Elsewhere' });
    const foreign = await createFolder(db, { projectId: other.id, name: 'Theirs' });

    await expect(
      services.artifactService.create(projectId, { title: 'Cross tenant', folderId: foreign.id }),
    ).rejects.toThrow(/folder/i);
  });

  it('returns filed artifacts alongside documents in the folder tree', async () => {
    const folder = await createFolder(db, { projectId, name: 'Mixed' });
    await createDocument(db, { projectId, title: 'A document', folderId: folder.id });
    await services.artifactService.create(projectId, {
      title: 'A report',
      kind: 'html',
      folderId: folder.id,
    });

    const tree = await services.documentService.listFolderTree(projectId);

    // Additive: `documents` keeps its shape and its consumers; artifacts arrive
    // in their own array carrying the folder and the kind the viewer branches on.
    expect(tree?.documents.map((doc) => doc.title)).toContain('A document');
    expect(tree?.artifacts).toEqual([
      expect.objectContaining({ title: 'A report', folder_id: folder.id, kind: 'html' }),
    ]);
  });

  it('leaves prototype screens out of the folder tree', async () => {
    const prototype = await services.prototypeService.create(projectId, {
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    await services.artifactService.create(projectId, {
      title: 'Screen',
      kind: 'html',
      content: '<main></main>',
      prototypeId: prototype?.id,
    });

    const tree = await services.documentService.listFolderTree(projectId);

    // A screen belongs to its prototype canvas, not the document tree.
    expect(tree?.artifacts).toEqual([]);
  });

  it('reparents artifacts as well as documents when a folder is deleted', async () => {
    const parent = await createFolder(db, { projectId, name: 'Parent' });
    const child = await createFolder(db, { projectId, name: 'Child', parentFolderId: parent.id });
    const doc = await createDocument(db, { projectId, title: 'Doc', folderId: child.id });
    const artifact = await services.artifactService.create(projectId, {
      title: 'Report',
      folderId: child.id,
    });

    await services.folderService.delete(child.id);

    // Never orphan: both kinds move to the deleted folder's parent. An artifact
    // left pointing at a deleted folder row is invisible in every tree read.
    expect((await services.documentService.get(doc.id))?.folder_id).toBe(parent.id);
    expect((await getArtifact(db, artifact?.id ?? ''))?.folderId).toBe(parent.id);
  });

  it('keeps a prototype screen out of the folder tree', async () => {
    const folder = await createFolder(db, { projectId, name: 'Reports' });
    const prototype = await services.prototypeService.create(projectId, {
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });

    // A screen is laid out from the link graph; filing it would give it two
    // conflicting homes.
    await expect(
      services.artifactService.create(projectId, {
        title: 'Screen',
        kind: 'html',
        content: '<main></main>',
        prototypeId: prototype?.id,
        folderId: folder.id,
      }),
    ).rejects.toThrow(/folder/i);
  });
});
