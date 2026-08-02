import type { SerializedArtifact, SerializedPrototypeLink } from '@/lib/api.js';

export type NavigateOutcome =
  | { kind: 'go'; artifactId: string; prototypeId: string | null }
  | { kind: 'broken'; reason: string; rawTarget: string }
  | { kind: 'unresolved'; reason: string; rawTarget: string };

const ARTIFACT_PREFIX = 'plandesk://artifact/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rawTargetKey(rawTarget: string): string {
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
 * Resolve a click using write-time `prototype_links` first.
 * Never writes. A null `to_artifact_id` is broken — do not navigate.
 * A missing row (runtime-built href) falls back to local id/title match.
 */
export function resolveNavigate(
  sourceArtifactId: string,
  rawTarget: string,
  links: readonly SerializedPrototypeLink[],
  screens: readonly SerializedArtifact[],
  currentPrototypeId: string,
): NavigateOutcome {
  const link = links.find(
    (row) => row.from_artifact_id === sourceArtifactId && row.raw_target === rawTarget,
  );

  if (link !== undefined) {
    if (link.to_artifact_id === null) {
      return {
        kind: 'broken',
        reason: `Unresolved link: ${rawTarget}`,
        rawTarget,
      };
    }
    const screen = screens.find((s) => s.id === link.to_artifact_id);
    return {
      kind: 'go',
      artifactId: link.to_artifact_id,
      prototypeId: screen?.prototype_id ?? currentPrototypeId,
    };
  }

  // No write-time row — runtime-generated link. Match locally; never invent edges.
  const key = rawTargetKey(rawTarget);
  if (key === '') {
    return {
      kind: 'unresolved',
      reason: `Cannot resolve empty navigation target`,
      rawTarget,
    };
  }

  if (UUID_RE.test(key)) {
    const byId = screens.find((s) => s.id === key);
    if (byId !== undefined) {
      return {
        kind: 'go',
        artifactId: byId.id,
        prototypeId: byId.prototype_id,
      };
    }
    return {
      kind: 'unresolved',
      reason: `No screen matches ${rawTarget}`,
      rawTarget,
    };
  }

  const inPrototype = screens.filter(
    (s) => s.prototype_id === currentPrototypeId && titleMatches(s.title, key),
  );
  if (inPrototype.length === 1 && inPrototype[0] !== undefined) {
    const only = inPrototype[0];
    return { kind: 'go', artifactId: only.id, prototypeId: only.prototype_id };
  }
  if (inPrototype.length > 1) {
    return {
      kind: 'unresolved',
      reason: `Ambiguous title match for ${rawTarget}`,
      rawTarget,
    };
  }

  const inProject = screens.filter((s) => titleMatches(s.title, key));
  if (inProject.length === 1 && inProject[0] !== undefined) {
    const only = inProject[0];
    return { kind: 'go', artifactId: only.id, prototypeId: only.prototype_id };
  }

  return {
    kind: 'unresolved',
    reason: `No screen matches ${rawTarget}`,
    rawTarget,
  };
}
