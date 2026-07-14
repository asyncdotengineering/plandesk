import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addAnnotation,
  isStale,
  listAnnotations,
  resolveAnnotation,
} from './annotations-store.js';

describe('annotation store', () => {
  const storeDirs: string[] = [];

  afterEach(() => {
    for (const dir of storeDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createStoreDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-annotations-'));
    storeDirs.push(dir);
    return dir;
  }

  it('adds and lists an annotation including its anchor JSON', async () => {
    const storeDir = createStoreDir();
    const absPath = join(storeDir, 'artifact.md');
    const anchor = JSON.stringify({
      type: 'TextQuoteSelector',
      exact: 'selected text',
      start: 4,
      end: 17,
    });

    const added = addAnnotation(
      absPath,
      '# selected text',
      { passage: 'selected text', anchor, body: 'A useful note' },
      storeDir,
    );

    expect(listAnnotations(absPath, storeDir)).toEqual([added]);
    expect(added).toMatchObject({
      passage: 'selected text',
      anchor,
      body: 'A useful note',
      resolved: false,
    });
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(added.createdAt).toISOString()).toBe(added.createdAt);
  });

  it('resolves an existing annotation', async () => {
    const storeDir = createStoreDir();
    const absPath = join(storeDir, 'artifact.html');
    const added = addAnnotation(absPath, '<p>Text</p>', { body: 'Done' }, storeDir);

    expect(resolveAnnotation(absPath, added.id, storeDir)).toBe(true);
    expect(listAnnotations(absPath, storeDir)[0]?.resolved).toBe(true);
  });

  it('returns an empty list for an unknown file', async () => {
    const storeDir = createStoreDir();
    expect(listAnnotations('/unknown/artifact.md', storeDir)).toEqual([]);
  });

  it('detects content changes after a write', async () => {
    const storeDir = createStoreDir();
    const absPath = join(storeDir, 'artifact.md');
    addAnnotation(absPath, 'original content', { body: 'Note' }, storeDir);

    expect(isStale(absPath, 'original content', storeDir)).toBe(false);
    expect(isStale(absPath, 'changed content', storeDir)).toBe(true);
  });

  it('rejects an empty annotation body', async () => {
    const storeDir = createStoreDir();
    expect(() =>
      addAnnotation('/artifact.md', 'content', { body: '   \n\t' }, storeDir),
    ).toThrow('Annotation body must not be empty or whitespace');
  });
});
