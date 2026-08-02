import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibraryEntry } from './manifest.js';
import { libraryVendorFilename } from './manifest.js';

/**
 * Resolve the vendor/libraries directory relative to this module.
 * Lazy: module-level fileURLToPath(import.meta.url) breaks the Cloudflare
 * Workers bundle (same pattern as migrate.ts / version()).
 */
function vendorLibrariesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../vendor/libraries');
}

/** Absolute path to the checked-in bytes for a manifest entry. */
export function libraryVendorPath(entry: LibraryEntry): string {
  return join(vendorLibrariesDir(), libraryVendorFilename(entry));
}

/** Read the vendored bytes from disk. Never fetches `sourceUrl`. */
export function readLibraryBytes(entry: LibraryEntry): Buffer {
  return readFileSync(libraryVendorPath(entry));
}

export function hashLibraryBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
