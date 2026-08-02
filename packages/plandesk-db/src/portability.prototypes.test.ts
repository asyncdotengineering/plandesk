import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { exportProject, importProject } from './portability.js';
import { createArtifact } from './repositories/artifacts.js';
import { createPrototype } from './repositories/prototypes.js';
import { createProjectInDefaultOrg as createProject } from './testing.js';
import { toPortableExportSnapshot } from './portability-export-canonical.js';

describe('prototypes file-backed export/import round-trip', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('export → import → re-export on two file-backed databases', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'plandesk-proto-src-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'plandesk-proto-dst-'));
    dirs.push(sourceDir, targetDir);

    const sourceDb = await createDb(join(sourceDir, 'source.db'));
    await migrate(sourceDb);
    const project = await createProject(sourceDb, { name: 'Proto Round Trip' });
    const proto = await createPrototype(sourceDb, {
      projectId: project.id,
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    await createArtifact(sourceDb, {
      projectId: project.id,
      title: 'Home',
      kind: 'html',
      content: '<html><body>home</body></html>',
      prototypeId: proto.id,
      x: 40,
      y: 80,
    });
    // Report without prototype must survive unchanged.
    await createArtifact(sourceDb, {
      projectId: project.id,
      title: 'Report',
      kind: 'markdown',
      content: '# Report',
    });

    const exported = await exportProject(sourceDb, project.id);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(exported.prototypes).toHaveLength(1);
    expect(exported.artifacts).toHaveLength(2);
    expect(exported.artifacts.find((a) => a.title === 'Home')?.prototype_id).toBe(proto.id);
    expect(exported.artifacts.find((a) => a.title === 'Report')?.prototype_id).toBeNull();

    const targetDb = await createDb(join(targetDir, 'target.db'));
    await migrate(targetDb);
    const { projectId: importedId } = await importProject(targetDb, exported);
    const reExported = await exportProject(targetDb, importedId);
    expect(reExported).toBeDefined();
    if (!reExported) {
      return;
    }

    expect(toPortableExportSnapshot(reExported).prototypes).toEqual(
      toPortableExportSnapshot(exported).prototypes,
    );
    expect(toPortableExportSnapshot(reExported).artifacts).toEqual(
      toPortableExportSnapshot(exported).artifacts,
    );
    expect(reExported.artifacts.find((a) => a.title === 'Home')?.x).toBe(40);
    expect(reExported.artifacts.find((a) => a.title === 'Home')?.y).toBe(80);
    expect(reExported.artifacts.find((a) => a.title === 'Report')?.prototype_id ?? null).toBeNull();
  });

  it('round-trips prototype→task and artifact→document edges', async () => {
    const { createEdge, createDocument, listEdges } = await import('./index.js');
    const { createTaskWithDefaultGoal: createTask } = await import('./testing.js');

    const sourceDir = mkdtempSync(join(tmpdir(), 'plandesk-proto-edge-src-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'plandesk-proto-edge-dst-'));
    dirs.push(sourceDir, targetDir);

    const sourceDb = await createDb(join(sourceDir, 'source.db'));
    await migrate(sourceDb);
    const project = await createProject(sourceDb, { name: 'Edge Round Trip' });
    const task = await createTask(sourceDb, { projectId: project.id, label: 'Build checkout' });
    const doc = await createDocument(sourceDb, { projectId: project.id, title: 'Screen spec' });
    const proto = await createPrototype(sourceDb, {
      projectId: project.id,
      name: 'Checkout',
      viewportWidth: 390,
      viewportHeight: 844,
    });
    const screen = await createArtifact(sourceDb, {
      projectId: project.id,
      title: 'Home',
      kind: 'html',
      content: '<html></html>',
      prototypeId: proto.id,
    });
    await createEdge(sourceDb, {
      projectId: project.id,
      fromType: 'prototype',
      fromId: proto.id,
      toType: 'task',
      toId: task.id,
      label: 'supports',
    });
    await createEdge(sourceDb, {
      projectId: project.id,
      fromType: 'artifact',
      fromId: screen.id,
      toType: 'document',
      toId: doc.id,
      label: 'documents',
    });

    const exported = await exportProject(sourceDb, project.id);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(
      exported.edges.some((edge) => edge.from_type === 'prototype' && edge.to_type === 'task'),
    ).toBe(true);
    expect(
      exported.edges.some((edge) => edge.from_type === 'artifact' && edge.to_type === 'document'),
    ).toBe(true);

    const targetDb = await createDb(join(targetDir, 'target.db'));
    await migrate(targetDb);
    const { projectId: importedId } = await importProject(targetDb, exported);
    const importedEdges = await listEdges(targetDb, importedId);
    expect(
      importedEdges.some((edge) => edge.fromType === 'prototype' && edge.toType === 'task'),
    ).toBe(true);
    expect(
      importedEdges.some((edge) => edge.fromType === 'artifact' && edge.toType === 'document'),
    ).toBe(true);
  });
});
