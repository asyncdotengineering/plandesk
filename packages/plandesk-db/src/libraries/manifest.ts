/**
 * Curated prototype libraries, shipped as content-addressed `files` rows.
 *
 * One definition — imported by DB materialisation and the API. Do not
 * duplicate this list elsewhere (see Decision: curated libraries as files).
 *
 * `sourceUrl` is provenance only. Materialisation and render never fetch it.
 */

export type LibraryEntry = {
  name: string;
  version: string;
  sha256: string;
  sourceUrl: string;
  license: string;
  bytes: number;
};

export const LIBRARY_MANIFEST: readonly LibraryEntry[] = [
  {
    name: 'mermaid',
    version: '11.16.0',
    sha256: '74d7c46dabca328c2294733910a8aa1ed0c37451776e8d5295da38a2b758fb9b',
    sourceUrl: 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js',
    license: 'MIT',
    bytes: 3565102,
  },
  {
    name: 'chart.js',
    version: '4.5.1',
    sha256: '48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a',
    sourceUrl: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
    license: 'MIT',
    bytes: 208522,
  },
] as const;

/** `plandesk://lib/<name>@<version>` */
export const LIBRARY_REF_PATTERN = /^plandesk:\/\/lib\/([^/@]+)@([^/@]+)$/;

export function parseLibraryRef(ref: string): { name: string; version: string } | null {
  const match = LIBRARY_REF_PATTERN.exec(ref);
  if (!match) {
    return null;
  }
  const name = match[1];
  const version = match[2];
  if (name === undefined || version === undefined) {
    return null;
  }
  return { name, version };
}

export function findLibraryEntry(name: string, version: string): LibraryEntry | undefined {
  return LIBRARY_MANIFEST.find((entry) => entry.name === name && entry.version === version);
}

export function findLibraryByRef(ref: string): LibraryEntry | undefined {
  const parsed = parseLibraryRef(ref);
  if (!parsed) {
    return undefined;
  }
  return findLibraryEntry(parsed.name, parsed.version);
}

/** On-disk filename under `vendor/libraries/` for a manifest entry. */
export function libraryVendorFilename(entry: LibraryEntry): string {
  return `${entry.name}@${entry.version}.js`;
}
