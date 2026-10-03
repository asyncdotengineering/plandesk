import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { checkDocumentReferences } from './reference-check.js';

const fs = {
  pathExists: (p: string) => existsSync(p),
  folderExists: (p: string) => existsSync(p),
};

describe('checkDocumentReferences', () => {
  it('returns unknown when folder_path is missing', () => {
    const result = checkDocumentReferences(
      null,
      [{ id: 'd1', title: 'Doc', sourcePath: 'readme.md' }],
      fs,
    );
    expect(result).toEqual({ checked: 1, findings: [], unknown: true });
  });

  it('returns unknown when fs is not available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-ref-'));
    try {
      const result = checkDocumentReferences(
        dir,
        [{ id: 'd1', title: 'Doc', sourcePath: 'readme.md' }],
        null,
      );
      expect(result).toEqual({ checked: 1, findings: [], unknown: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports exactly one missing file when one source_path is deleted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-ref-'));
    try {
      writeFileSync(join(dir, 'kept.md'), '# ok');
      const result = checkDocumentReferences(
        dir,
        [
          { id: 'a', title: 'Kept', sourcePath: 'kept.md' },
          { id: 'b', title: 'Gone', sourcePath: 'gone.md' },
        ],
        fs,
      );
      expect(result.unknown).toBe(false);
      expect(result.checked).toBe(2);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        document_id: 'b',
        source_path: 'gone.md',
        state: 'missing',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns zero findings when every source_path exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-ref-'));
    try {
      writeFileSync(join(dir, 'a.md'), 'a');
      writeFileSync(join(dir, 'b.md'), 'b');
      const result = checkDocumentReferences(
        dir,
        [
          { id: 'a', title: 'A', sourcePath: 'a.md' },
          { id: 'b', title: 'B', sourcePath: 'b.md' },
        ],
        fs,
      );
      expect(result).toEqual({ checked: 2, findings: [], unknown: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
