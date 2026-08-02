import { describe, expect, it } from 'vitest';
import { hashLibraryBytes, readLibraryBytes } from './bytes.js';
import {
  LIBRARY_MANIFEST,
  findLibraryByRef,
  libraryVendorFilename,
  parseLibraryRef,
} from './manifest.js';

describe('LIBRARY_MANIFEST', () => {
  it('seeds exactly mermaid and chart.js', () => {
    expect(LIBRARY_MANIFEST.map((e) => e.name).sort()).toEqual(['chart.js', 'mermaid']);
  });

  it('records MIT for every seeded library', () => {
    for (const entry of LIBRARY_MANIFEST) {
      expect(entry.license).toBe('MIT');
    }
  });

  it('parses plandesk://lib/<name>@<version> refs', () => {
    expect(parseLibraryRef('plandesk://lib/mermaid@11.16.0')).toEqual({
      name: 'mermaid',
      version: '11.16.0',
    });
    expect(parseLibraryRef('plandesk://lib/chart.js@4.5.1')).toEqual({
      name: 'chart.js',
      version: '4.5.1',
    });
    expect(parseLibraryRef('plandesk://lib/mermaid')).toBeNull();
    expect(parseLibraryRef('plandesk://file/abc')).toBeNull();
    expect(findLibraryByRef('plandesk://lib/mermaid@9.9.9')).toBeUndefined();
  });
});

describe('vendored bytes match the manifest sha256', () => {
  it.each(LIBRARY_MANIFEST)('$name@$version on-disk bytes hash to the manifest sha256', (entry) => {
    const bytes = readLibraryBytes(entry);
    expect(bytes.length).toBe(entry.bytes);
    expect(hashLibraryBytes(bytes)).toBe(entry.sha256);
    expect(libraryVendorFilename(entry)).toBe(`${entry.name}@${entry.version}.js`);
  });
});
