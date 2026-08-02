import {
  evictRevisionsBeyondCap,
  insertRevision,
  type DbClient,
  type NewRevision,
  type Revision,
} from '@plandesk/db';

export const TASK_VERSIONED_FIELDS = ['label', 'description'] as const;
export const DOCUMENT_VERSIONED_FIELDS = ['title', 'body', 'statusLine'] as const;
export const ARTIFACT_VERSIONED_FIELDS = ['title', 'content', 'kind'] as const;

export type MaxRevisionsEnv = {
  PLANDESK_MAX_REVISIONS?: string;
};

/**
 * `null` = keep every revision (unset or `-1`).
 * Positive integer = keep that many per target.
 * Anything else throws — never silently unlimited.
 */
export function maxRevisionsFromEnv(env: MaxRevisionsEnv): number | null {
  const raw = env.PLANDESK_MAX_REVISIONS;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '-1') {
    return null;
  }
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(
      `PLANDESK_MAX_REVISIONS must be a positive integer or -1 (unlimited); got ${JSON.stringify(raw)}`,
    );
  }
  return Number(trimmed);
}

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

/**
 * Insert a revision and, when capped, evict oldest-first for that target.
 * Callers must invoke this inside the same write transaction as the entity update.
 */
export async function captureRevision(
  tx: DbClient,
  input: NewRevision,
  maxRevisions: number | null,
): Promise<Revision> {
  const row = await insertRevision(tx, input);
  if (maxRevisions !== null) {
    await evictRevisionsBeyondCap(tx, input.targetType, input.targetId, maxRevisions);
  }
  return row;
}
