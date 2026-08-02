import { describe, expect, it } from 'vitest';
import { LIBRARY_MANIFEST } from '@plandesk/db';
import { createTestApp, parseJson } from '../test-helpers.js';

type LibrariesResponse = {
  libraries: Array<{
    name: string;
    version: string;
    sha256: string;
    sourceUrl: string;
    license: string;
    bytes: number;
  }>;
};

describe('GET /api/v1/libraries', () => {
  it('returns the curated manifest from @plandesk/db (single definition)', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/libraries');
    expect(res.status).toBe(200);
    const body = await parseJson<LibrariesResponse>(res);
    expect(body.libraries).toHaveLength(LIBRARY_MANIFEST.length);
    expect(body.libraries.map((l) => l.name).sort()).toEqual(['chart.js', 'mermaid']);
    for (const entry of LIBRARY_MANIFEST) {
      const found = body.libraries.find(
        (l) => l.name === entry.name && l.version === entry.version,
      );
      expect(found).toEqual({
        name: entry.name,
        version: entry.version,
        sha256: entry.sha256,
        sourceUrl: entry.sourceUrl,
        license: entry.license,
        bytes: entry.bytes,
      });
    }
  });
});
