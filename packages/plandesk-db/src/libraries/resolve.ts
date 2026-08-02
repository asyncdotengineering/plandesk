import type { DbClient } from '../client.js';
import { createFile, getFile } from '../repositories/files.js';
import { hashLibraryBytes, readLibraryBytes } from './bytes.js';
import { findLibraryByRef, type LibraryEntry } from './manifest.js';

export class LibrarySha256MismatchError extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`Library bytes sha256 mismatch: expected ${expected}, got ${actual}`);
    this.name = 'LibrarySha256MismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Verify bytes against the manifest sha256, then upsert a `files` row whose
 * id is that hash. Idempotent within a project (PK is project_id + id).
 *
 * Accepts optional `bytes` for tests that need to assert tamper refusal;
 * production callers omit it and load the checked-in vendor file.
 */
export async function materialiseLibrary(
  db: DbClient,
  entry: LibraryEntry,
  projectId: string,
  bytes?: Buffer,
): Promise<{ fileId: string }> {
  const payload = bytes ?? readLibraryBytes(entry);
  const actual = hashLibraryBytes(payload);
  if (actual !== entry.sha256) {
    throw new LibrarySha256MismatchError(entry.sha256, actual);
  }
  if (payload.length !== entry.bytes) {
    throw new LibrarySha256MismatchError(
      entry.sha256,
      `${actual} (byte length ${String(payload.length)}, expected ${String(entry.bytes)})`,
    );
  }

  await createFile(db, {
    id: entry.sha256,
    projectId,
    filename: `${entry.name}@${entry.version}.js`,
    mime: 'application/javascript',
    size: payload.length,
    bytes: payload,
  });

  const row = await getFile(db, projectId, entry.sha256);
  if (!row) {
    throw new Error(`Failed to materialise library ${entry.name}@${entry.version}`);
  }
  return { fileId: row.id };
}

/**
 * Resolve `plandesk://lib/<name>@<version>` into a project-scoped file id,
 * materialising the vendored bytes on first use.
 *
 * Returns null for a malformed ref or a name/version absent from the
 * manifest. Callers that need a hard refusal (write-time scan) own that
 * policy — this function is the materialise path only.
 */
export async function resolveLibrary(
  db: DbClient,
  ref: string,
  projectId: string,
): Promise<{ fileId: string } | null> {
  const entry = findLibraryByRef(ref);
  if (!entry) {
    return null;
  }
  return materialiseLibrary(db, entry, projectId);
}
