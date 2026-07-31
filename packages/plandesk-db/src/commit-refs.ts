/**
 * Shared validation for task commit reference SHAs.
 * Used by the HTTP route and MCP tool schemas — one policy, both boundaries.
 */

/** Lowercase hex, short (7) through full (40) SHAs. Case-insensitive at input. */
export const COMMIT_REF_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Hard cap — a task spanning more commits than this is not a task. */
export const MAX_COMMIT_REFS = 50;

/**
 * Worst-case JSON length for {@link MAX_COMMIT_REFS} full (40-char) SHAs.
 * `parseCommitRefs` rejects raw columns longer than this before `JSON.parse`.
 */
export const MAX_COMMIT_REFS_RAW_LENGTH = JSON.stringify(
  Array.from({ length: MAX_COMMIT_REFS }, () => 'a'.repeat(40)),
).length;

export function isValidCommitRef(value: string): boolean {
  return COMMIT_REF_PATTERN.test(value);
}

export function isValidCommitRefs(values: string[]): boolean {
  return values.length <= MAX_COMMIT_REFS && values.every(isValidCommitRef);
}

/** Canonical stored form. Call only after validation — does not re-check. */
export function normalizeCommitRef(value: string): string {
  return value.toLowerCase();
}

export function normalizeCommitRefs(values: string[]): string[] {
  return values.map(normalizeCommitRef);
}

/**
 * Parse the JSON `commit_refs` column into a real string[].
 * Fail-closed: over-length raw text never reaches `JSON.parse`; corrupt data
 * returns `[]` without throwing.
 */
export function parseCommitRefs(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  if (raw.length > MAX_COMMIT_REFS_RAW_LENGTH) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length <= MAX_COMMIT_REFS &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}
