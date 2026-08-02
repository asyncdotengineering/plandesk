import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { exportProject, importProject } from '../portability.js';
import { createArtifact } from '../repositories/artifacts.js';
import { getFile, listFilesByProject } from '../repositories/files.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { hashLibraryBytes, readLibraryBytes } from './bytes.js';
import { LIBRARY_MANIFEST, findLibraryEntry } from './manifest.js';
import { LibrarySha256MismatchError, materialiseLibrary, resolveLibrary } from './resolve.js';

describe('materialiseLibrary / resolveLibrary', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Libs' })).id;
  });

  it('materialises mermaid as a files row whose id equals the manifest sha256', async () => {
    const entry = findLibraryEntry('mermaid', '11.16.0');
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    const { fileId } = await materialiseLibrary(db, entry, projectId);
    expect(fileId).toBe(entry.sha256);
    const row = await getFile(db, projectId, fileId);
    expect(row?.id).toBe(entry.sha256);
    expect(row?.filename).toBe('mermaid@11.16.0.js');
    expect(row?.mime).toBe('application/javascript');
    expect(row?.size).toBe(entry.bytes);
    expect(row?.bytes).toBeDefined();
    if (!row?.bytes) {
      return;
    }
    expect(hashLibraryBytes(row.bytes)).toBe(entry.sha256);
  }, 30_000);

  it('materialising mermaid twice in one project is a no-op (one row, no throw)', async () => {
    const entry = findLibraryEntry('mermaid', '11.16.0');
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    const first = await materialiseLibrary(db, entry, projectId);
    const second = await materialiseLibrary(db, entry, projectId);
    expect(second.fileId).toBe(first.fileId);
    expect(await listFilesByProject(db, projectId)).toHaveLength(1);
  }, 30_000);

  it('materialising the same library in two projects yields two rows with the same id', async () => {
    const entry = findLibraryEntry('mermaid', '11.16.0');
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    const otherId = (await createProject(db, { name: 'Other' })).id;
    const a = await materialiseLibrary(db, entry, projectId);
    const b = await materialiseLibrary(db, entry, otherId);
    expect(a.fileId).toBe(entry.sha256);
    expect(b.fileId).toBe(entry.sha256);
    expect(a.fileId).toBe(b.fileId);
    expect(await listFilesByProject(db, projectId)).toHaveLength(1);
    expect(await listFilesByProject(db, otherId)).toHaveLength(1);
  }, 30_000);

  it('refuses a tampered byte stream at materialisation', async () => {
    const entry = findLibraryEntry('chart.js', '4.5.1');
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }
    const good = readLibraryBytes(entry);
    const tampered = Buffer.from(good);
    tampered[10] = tampered[10] === 0 ? 1 : 0;
    expect(hashLibraryBytes(tampered)).not.toBe(entry.sha256);

    await expect(materialiseLibrary(db, entry, projectId, tampered)).rejects.toBeInstanceOf(
      LibrarySha256MismatchError,
    );
    await expect(materialiseLibrary(db, entry, projectId, tampered)).rejects.toThrow(
      /sha256 mismatch/,
    );
    expect(await listFilesByProject(db, projectId)).toHaveLength(0);
  });

  it('resolveLibrary materialises from a plandesk://lib ref and returns null for unknowns', async () => {
    const resolved = await resolveLibrary(db, 'plandesk://lib/chart.js@4.5.1', projectId);
    expect(resolved?.fileId).toBe(findLibraryEntry('chart.js', '4.5.1')?.sha256);
    expect(await resolveLibrary(db, 'plandesk://lib/unknown@1.0.0', projectId)).toBeNull();
    expect(await resolveLibrary(db, 'not-a-ref', projectId)).toBeNull();
  });
});

describe('library export → import → re-export on file-backed databases', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('carries library bytes; screen content keeps the lib ref (no inlined source)', async () => {
    // Use chart.js (≈200KB) for the round-trip body; mermaid (≈3.5MB) is
    // covered by materialise tests. File-backed DBs still exercise BLOB
    // persistence — the contract the design rests on.
    const entry = LIBRARY_MANIFEST.find((e) => e.name === 'chart.js');
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }

    const sourceDir = mkdtempSync(join(tmpdir(), 'plandesk-lib-src-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'plandesk-lib-dst-'));
    dirs.push(sourceDir, targetDir);

    const sourceDb = await createDb(join(sourceDir, 'source.db'));
    await migrate(sourceDb);
    const project = await createProject(sourceDb, { name: 'Lib Round Trip' });
    await materialiseLibrary(sourceDb, entry, project.id);

    const screenContent =
      '<html><body><script src="plandesk://lib/chart.js@4.5.1"></script></body></html>';
    await createArtifact(sourceDb, {
      projectId: project.id,
      title: 'Chart screen',
      kind: 'html',
      content: screenContent,
    });

    const exported = await exportProject(sourceDb, project.id);
    expect(exported).toBeDefined();
    if (!exported) {
      return;
    }
    expect(exported.files).toHaveLength(1);
    expect(exported.files[0]?.id).toBe(entry.sha256);
    const exportedBytes = Buffer.from(exported.files[0]?.bytes_base64 ?? '', 'base64');
    expect(hashLibraryBytes(exportedBytes)).toBe(entry.sha256);
    expect(exported.artifacts[0]?.content).toBe(screenContent);
    expect(exported.artifacts[0]?.content).toContain('plandesk://lib/chart.js@4.5.1');
    // artifacts.content must not contain the library source.
    const artifactContent = exported.artifacts[0]?.content;
    const fileB64 = exported.files[0]?.bytes_base64;
    expect(artifactContent).toBeTruthy();
    expect(fileB64).toBeTruthy();
    if (typeof artifactContent !== 'string' || typeof fileB64 !== 'string') {
      return;
    }
    expect(artifactContent.includes(fileB64)).toBe(false);

    const targetDb = await createDb(join(targetDir, 'target.db'));
    await migrate(targetDb);
    const { projectId: importedId } = await importProject(targetDb, exported);

    const importedFile = await getFile(targetDb, importedId, entry.sha256);
    expect(importedFile?.bytes).toBeDefined();
    if (!importedFile?.bytes) {
      return;
    }
    expect(hashLibraryBytes(importedFile.bytes)).toBe(entry.sha256);
    expect(importedFile.id).toBe(entry.sha256);

    const reExported = await exportProject(targetDb, importedId);
    expect(reExported).toBeDefined();
    if (!reExported) {
      return;
    }
    expect(reExported.files[0]?.id).toBe(exported.files[0]?.id);
    expect(hashLibraryBytes(Buffer.from(reExported.files[0]?.bytes_base64 ?? '', 'base64'))).toBe(
      entry.sha256,
    );
    expect(reExported.artifacts[0]?.content).toBe(screenContent);
    expect(reExported.artifacts[0]?.content).toContain('plandesk://lib/chart.js@4.5.1');
  }, 30_000);
});
