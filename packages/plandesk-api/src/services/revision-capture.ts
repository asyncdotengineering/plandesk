export const TASK_VERSIONED_FIELDS = ['label', 'description'] as const;
export const DOCUMENT_VERSIONED_FIELDS = ['title', 'body', 'statusLine'] as const;

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a == null && b == null) {
    return true;
  }
  return false;
}

/** Versioned fields present in `input` whose values differ from `prior`. */
export function changedVersionedFields<T extends string>(
  prior: Record<string, unknown>,
  input: Record<string, unknown>,
  versionedFields: readonly T[],
): T[] {
  const changed: T[] = [];
  for (const field of versionedFields) {
    if (!(field in input)) {
      continue;
    }
    if (!valuesEqual(prior[field], input[field])) {
      changed.push(field);
    }
  }
  return changed;
}

/** Complete prior values for every versioned field (not a delta). */
export function versionedFieldSnapshot<T extends string>(
  prior: Record<string, unknown>,
  versionedFields: readonly T[],
): Record<T, unknown> {
  const snapshot = {} as Record<T, unknown>;
  for (const field of versionedFields) {
    const value = prior[field];
    snapshot[field] = value ?? null;
  }
  return snapshot;
}
