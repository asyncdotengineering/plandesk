import { Hono } from 'hono';
import { LIBRARY_MANIFEST, type LibraryEntry } from '@plandesk/db';

/**
 * Expose the curated library manifest for authoring-skill generation.
 * Data only — no project scope; the same list is imported from `@plandesk/db`.
 */
export function createLibrariesRouter(): Hono {
  const router = new Hono();

  router.get('/libraries', (c) => {
    const libraries: LibraryEntry[] = LIBRARY_MANIFEST.map((entry) => ({
      name: entry.name,
      version: entry.version,
      sha256: entry.sha256,
      sourceUrl: entry.sourceUrl,
      license: entry.license,
      bytes: entry.bytes,
    }));
    return c.json({ libraries });
  });

  return router;
}
