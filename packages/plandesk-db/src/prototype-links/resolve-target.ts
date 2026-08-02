/**
 * Pure navigation-target resolution. Callers load candidate screens from the
 * DB and pass them in — this module never touches storage.
 */

const ARTIFACT_PREFIX = 'plandesk://artifact/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ResolveTargetScreen = {
  id: string;
  title: string;
  prototypeId: string | null;
};

/**
 * Strip the `plandesk://artifact/` prefix when present; otherwise treat the
 * whole string as the target (UUID or title).
 */
export function rawTargetKey(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.toLowerCase().startsWith(ARTIFACT_PREFIX)) {
    return trimmed.slice(ARTIFACT_PREFIX.length);
  }
  return trimmed;
}

function titleMatches(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

/**
 * Resolve a navigation target against already-loaded screens.
 *
 * - UUID → match by id within the project screens list; missing → null.
 * - Title → case-insensitive match, prototype-scoped first, then project-wide.
 * - Zero or multiple matches in the active scope → null (never guess).
 */
export function resolveTarget(
  rawTarget: string,
  screens: readonly ResolveTargetScreen[],
  prototypeId: string,
): string | null {
  const key = rawTargetKey(rawTarget);
  if (key === '') {
    return null;
  }

  if (UUID_RE.test(key)) {
    const byId = screens.find((s) => s.id === key);
    return byId ? byId.id : null;
  }

  const inPrototype = screens.filter(
    (s) => s.prototypeId === prototypeId && titleMatches(s.title, key),
  );
  if (inPrototype.length === 1) {
    const only = inPrototype[0];
    return only ? only.id : null;
  }
  if (inPrototype.length > 1) {
    return null;
  }

  const inProject = screens.filter((s) => titleMatches(s.title, key));
  if (inProject.length === 1) {
    const only = inProject[0];
    return only ? only.id : null;
  }
  return null;
}
