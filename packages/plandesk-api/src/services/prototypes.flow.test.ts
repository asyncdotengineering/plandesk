import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createFolder,
  createProjectInDefaultOrg as createProject,
  getFolder,
  listDocuments,
  listEdgesByEndpoint,
  listFolders,
  migrate,
  updateDocument,
  type Db,
} from '@plandesk/db';
import { createArtifactService } from './artifacts.js';
import { createPrototypeService } from './prototypes.js';

describe('prototype folder + flow document', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Flow folders' });
    projectId = project.id;
    orgId = project.orgId;
  });

  function prototypes() {
    return createPrototypeService({ db, orgId });
  }

  function artifacts() {
    return createArtifactService({ db, orgId });
  }

  it('creates exactly one folder and one flow document edged to the prototype', async () => {
    const beforeFolders = await listFolders(db, projectId);
    const beforeDocs = await listDocuments(db, projectId);

    const proto = await prototypes().create(projectId, {
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }
    expect(proto.folder_id).toBeTruthy();
    if (!proto.folder_id) {
      return;
    }

    const afterFolders = await listFolders(db, projectId);
    const afterDocs = await listDocuments(db, projectId);
    expect(afterFolders).toHaveLength(beforeFolders.length + 1);
    expect(afterDocs).toHaveLength(beforeDocs.length + 1);

    const folder = await getFolder(db, proto.folder_id);
    expect(folder?.name).toBe('Checkout');
    expect(folder?.projectId).toBe(projectId);

    const flow = afterDocs.find((d) => d.folderId === proto.folder_id);
    expect(flow).toBeDefined();
    expect(flow?.title).toBe('Design: Checkout flow');
    expect(flow?.folderId).toBe(proto.folder_id);
    expect(flow?.body).toContain('| Screen | Purpose | States it must show |');
    expect(flow?.body).toContain('| From | To | Trigger |');

    const edges = await listEdgesByEndpoint(db, projectId, 'prototype', proto.id);
    const docEdge = edges.find(
      (e) => e.fromType === 'document' && e.fromId === flow?.id && e.toType === 'prototype',
    );
    expect(docEdge).toBeDefined();
    expect(docEdge?.label).toBe('documents');
  });

  it('places the flow document in the folder, not at project root', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Onboarding',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto?.folder_id) {
      return;
    }
    const docs = await listDocuments(db, projectId);
    const flow = docs.find((d) => d.title === 'Design: Onboarding flow');
    expect(flow?.folderId).toBe(proto.folder_id);
    expect(flow?.folderId).not.toBeNull();
  });

  it('links a screen to the flow document on create', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Pay',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }
    const screen = await artifacts().create(projectId, {
      title: 'Cart',
      kind: 'html',
      content: '<html></html>',
      prototypeId: proto.id,
    });
    expect(screen).toBeDefined();
    if (!screen) {
      return;
    }

    const docs = await listDocuments(db, projectId);
    const flow = docs.find((d) => d.folderId === proto.folder_id);
    expect(flow).toBeDefined();
    if (!flow) {
      return;
    }

    const edges = await listEdgesByEndpoint(db, projectId, 'artifact', screen.id);
    const link = edges.find(
      (e) =>
        e.fromType === 'artifact' &&
        e.fromId === screen.id &&
        e.toType === 'document' &&
        e.toId === flow.id,
    );
    expect(link).toBeDefined();
  });

  it('renames the folder when the prototype is renamed; document keeps its edges', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Old name',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto?.folder_id) {
      return;
    }
    const docs = await listDocuments(db, projectId);
    const flow = docs.find((d) => d.folderId === proto.folder_id);
    expect(flow).toBeDefined();
    if (!flow) {
      return;
    }

    const updated = await prototypes().update(proto.id, { name: 'New name' });
    expect(updated?.name).toBe('New name');
    const folder = await getFolder(db, proto.folder_id);
    expect(folder?.name).toBe('New name');

    const edges = await listEdgesByEndpoint(db, projectId, 'document', flow.id);
    expect(edges.some((e) => e.toType === 'prototype' && e.toId === proto.id)).toBe(true);
  });

  it('does not disturb existing folders or documents', async () => {
    const existingFolder = await createFolder(db, {
      projectId,
      name: 'Existing docs',
    });
    const existingDoc = await createDocument(db, {
      projectId,
      title: 'Keep me',
      folderId: existingFolder.id,
      body: 'stay',
    });

    await prototypes().create(projectId, {
      name: 'Fresh',
      viewportWidth: 1024,
      viewportHeight: 768,
    });

    const folder = await getFolder(db, existingFolder.id);
    expect(folder?.name).toBe('Existing docs');
    const docs = await listDocuments(db, projectId);
    const kept = docs.find((d) => d.id === existingDoc.id);
    expect(kept?.title).toBe('Keep me');
    expect(kept?.folderId).toBe(existingFolder.id);
    expect(kept?.body).toBe('stay');
  });

  it('get_prototype reports named missing screens and unparseable flow docs', async () => {
    const proto = await prototypes().create(projectId, {
      name: 'Cover',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(proto).toBeDefined();
    if (!proto) {
      return;
    }

    const flow = await listDocuments(db, projectId).then((docs) =>
      docs.find((d) => d.folderId === proto.folder_id),
    );
    expect(flow).toBeDefined();
    if (!flow) {
      return;
    }

    await updateDocument(db, flow.id, {
      body: [
        '| Screen | Purpose | States it must show |',
        '| --- | --- | --- |',
        '| One | a | default |',
        '| Two | b | default |',
        '| Three | c | default |',
        '| Four | d | default |',
      ].join('\n'),
    });

    await artifacts().create(projectId, {
      title: 'One',
      kind: 'html',
      content: '<p>1</p>',
      prototypeId: proto.id,
    });
    await artifacts().create(projectId, {
      title: 'Two',
      kind: 'html',
      content: '<p>2</p>',
      prototypeId: proto.id,
    });
    await artifacts().create(projectId, {
      title: 'Three',
      kind: 'html',
      content: '<p>3</p>',
      prototypeId: proto.id,
    });

    const got = await prototypes().get(proto.id);
    expect(got?.coverage.parseable).toBe(true);
    expect(got?.coverage.missing).toEqual(['Four']);

    await updateDocument(db, flow.id, { body: '# no table at all' });
    const unparseable = await prototypes().get(proto.id);
    expect(unparseable?.coverage.parseable).toBe(false);
    expect(unparseable?.coverage.parse_error).toMatch(/no screens table/i);
    expect(unparseable?.coverage.missing).toEqual([]);
  });
});
