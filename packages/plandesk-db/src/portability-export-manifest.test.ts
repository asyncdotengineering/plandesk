import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate } from './migrate.js';
import {
  assertGoldenExportFieldCoverage,
  canonicalizeExportForComparison,
  toPortableExportSnapshot,
} from './portability-export-canonical.js';
import {
  _createExportAuxForTest,
  PLANDESK_EXPORT_TABLE_COLLECTIONS,
  PLANDESK_EXPORT_TABLE_MANIFEST,
  PLANDESK_EXPORT_TABLES,
} from './portability-export-manifest.js';
import { buildExportFromManifest, exportProject, importProject } from './portability.js';
import {
  FIXTURE_EXPORT_IDS,
  seedDeterministicFullyPopulatedProject,
} from './portability-fixture-seed.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../test-fixtures/fully-populated-export.json',
);

function loadGoldenExportFixture(): ReturnType<typeof canonicalizeExportForComparison> {
  const raw = JSON.parse(
    readFileSync(fixturePath, 'utf8'),
  ) as import('./portability.js').PlandeskExport;
  return canonicalizeExportForComparison(raw);
}

describe('portability export manifest', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });

  it('registers every export table with read, collection, serializer, and import where required', () => {
    const manifestTables = Object.keys(PLANDESK_EXPORT_TABLE_MANIFEST).sort();
    expect(manifestTables).toEqual([...PLANDESK_EXPORT_TABLES].sort());

    for (const tableName of PLANDESK_EXPORT_TABLES) {
      const spec = PLANDESK_EXPORT_TABLE_MANIFEST[tableName];
      expect(spec.collection, `${tableName} missing collection`).toBeTruthy();
      expect(spec.import.emit, `${tableName} missing import.emit`).toBeTypeOf('function');
      if (spec.scope === 'singleton' || spec.scope === 'rows' || spec.scope === 'association') {
        expect(spec.read, `${tableName} missing read`).toBeTypeOf('function');
      }
      if (spec.scope === 'singleton' || spec.scope === 'rows') {
        expect(spec.serialize, `${tableName} missing serialize`).toBeTypeOf('function');
      }
      if (spec.scope === 'association' || spec.scope === 'nested_per_parent') {
        expect(spec.initAux, `${tableName} missing initAux`).toBeTypeOf('function');
        expect(spec.auxKey, `${tableName} missing auxKey`).toBeTruthy();
      }
      if (spec.scope === 'nested_per_parent') {
        expect(spec.read, `${tableName} missing read`).toBeTypeOf('function');
        expect(spec.parentIdFrom, `${tableName} missing parentIdFrom`).toBeTypeOf('function');
      }
    }
  });

  it('exports a fully-populated project matching the golden fixture semantically', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    assertGoldenExportFieldCoverage(exported);
    const golden = loadGoldenExportFixture();
    const canonical = canonicalizeExportForComparison(exported);
    expect(canonical).toEqual(golden);

    const reordered = {
      ...exported,
      project: {
        canvas_layout: exported.project.canvas_layout,
        description: exported.project.description,
        folder_path: exported.project.folder_path,
        name: exported.project.name,
        owner_id: exported.project.owner_id,
        overview_document_id: exported.project.overview_document_id,
        repo_url: exported.project.repo_url,
      },
    };
    expect(canonicalizeExportForComparison(reordered)).toEqual(golden);
  });

  it('golden fixture catches a dropped serializer column (repo_url)', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    const withoutRepoUrl = {
      ...exported,
      project: { ...exported.project, repo_url: undefined },
    };
    expect(() => {
      assertGoldenExportFieldCoverage(withoutRepoUrl);
    }).toThrow(/repo_url/);
  });

  it('exportProject cannot smuggle unregistered collections — only manifest assembly reaches the blob', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect('shares' in exported).toBe(false);

    const { version, ...collections } = exported;
    void version;
    const withShares = { ...collections, shares: [{ id: 'share-1' }] } as Omit<
      import('./portability.js').PlandeskExport,
      'version'
    >;
    expect(() => buildExportFromManifest(withShares)).toThrow(
      'export collection not registered in PLANDESK_EXPORT_TABLES: shares',
    );
  });

  it('mutating the exported registry cannot get an unregistered key into the blob', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }

    const collections = PLANDESK_EXPORT_TABLE_COLLECTIONS as Record<string, string>;
    expect(() => {
      collections.projects = 'shares';
    }).toThrow();

    const { version, ...payload } = exported;
    void version;
    const withShares = { ...payload, shares: [{ id: 'share-1' }] } as Omit<
      import('./portability.js').PlandeskExport,
      'version'
    >;
    expect(() => buildExportFromManifest(withShares)).toThrow(/shares/);
    expect('shares' in exported).toBe(false);
  });

  it('association and nested aux initialisation is manifest-driven only', () => {
    const aux = _createExportAuxForTest();
    expect(aux.task_tags).toBeInstanceOf(Map);
    expect(aux.agent_run_events).toBeInstanceOf(Map);
    expect(Object.keys(aux).sort()).toEqual(['agent_run_events', 'task_tags']);
  });

  it('rejects unregistered collections on import (shares)', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }

    const withShares = { ...exported, shares: [{ id: 'share-1' }] };
    await expect(importProject(db, withShares)).rejects.toThrow(
      'import collection not registered in PLANDESK_EXPORT_TABLES: shares',
    );
  });

  it('imports legacy document_comments-shaped blobs', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }

    const legacyDocumentComment = exported.comments.find(
      (comment) => comment.id === FIXTURE_EXPORT_IDS.docComment,
    );
    expect(legacyDocumentComment).toBeDefined();
    if (!legacyDocumentComment) {
      return;
    }

    const legacy = {
      ...exported,
      comments: exported.comments.filter((comment) => comment.target_type !== 'document'),
      document_comments: [
        {
          id: legacyDocumentComment.id,
          document_id: legacyDocumentComment.target_id,
          passage: legacyDocumentComment.passage,
          body: legacyDocumentComment.body,
          resolved: legacyDocumentComment.resolved,
          created_at: legacyDocumentComment.created_at,
        },
      ],
    };
    const targetDb = await createDb(':memory:');
    await migrate(targetDb);
    const { projectId: importedId } = await importProject(targetDb, legacy);
    const reExported = await exportProject(targetDb, importedId);
    expect(reExported).toBeDefined();
    if (!reExported) {
      return;
    }

    const reimportedDocumentComment = reExported.comments.find(
      (comment) =>
        comment.target_type === 'document' &&
        comment.body === legacyDocumentComment.body &&
        comment.passage === legacyDocumentComment.passage,
    );
    expect(reimportedDocumentComment).toMatchObject({
      target_type: 'document',
      body: 'DISTINCT-comment-body',
      passage: 'DISTINCT-passage',
      resolved: true,
      created_at: legacyDocumentComment.created_at,
    });
    expect(reExported.comments).toHaveLength(exported.comments.length);
  });

  it('canonical comparison treats edge order as semantically irrelevant', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(exported.edges.length).toBeGreaterThanOrEqual(1);
    const [seedEdge] = exported.edges;
    if (!seedEdge) {
      return;
    }

    const tiedEdgeA = { ...seedEdge, id: '00000000-0000-4000-8000-00000000e001' };
    const tiedEdgeB = { ...seedEdge, id: '00000000-0000-4000-8000-00000000e002' };
    const ordered = { ...exported, edges: [tiedEdgeA, tiedEdgeB] };
    const reversed = { ...exported, edges: [tiedEdgeB, tiedEdgeA] };

    expect(canonicalizeExportForComparison(ordered)).toEqual(
      canonicalizeExportForComparison(reversed),
    );
  });

  it('canonical comparison still detects a changed edge value', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(exported.edges.length).toBeGreaterThanOrEqual(1);
    const [seedEdge] = exported.edges;
    if (!seedEdge) {
      return;
    }

    const tiedEdgeA = { ...seedEdge, id: '00000000-0000-4000-8000-00000000e001' };
    const tiedEdgeB = { ...seedEdge, id: '00000000-0000-4000-8000-00000000e002' };
    const baseline = { ...exported, edges: [tiedEdgeA, tiedEdgeB] };
    const mutated = {
      ...baseline,
      edges: [{ ...tiedEdgeA, label: 'MUTATED-EDGE-LABEL' }, tiedEdgeB],
    };

    expect(canonicalizeExportForComparison(baseline)).not.toEqual(
      canonicalizeExportForComparison(mutated),
    );
  });

  it('import round-trips every manifest-exported collection — shares without import handler cannot compile', async () => {
    const projectId = await seedDeterministicFullyPopulatedProject(db);
    const exported = await exportProject(db, projectId);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }

    const targetDb = await createDb(':memory:');
    await migrate(targetDb);
    const { projectId: importedId } = await importProject(targetDb, exported);
    const reExported = await exportProject(targetDb, importedId);
    expect(reExported).toBeDefined();
    if (!reExported) {
      return;
    }

    expect(toPortableExportSnapshot(reExported)).toEqual(toPortableExportSnapshot(exported));
    expect('shares' in reExported).toBe(false);
  });
});
