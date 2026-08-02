/**
 * Per-screen runtime diagnostics from the frame shim.
 * In-memory only — cleared on revision change; do not persist.
 */

export type ScreenDiagnostic =
  | { kind: 'blocked'; directive: string; blockedUri: string; at: number }
  | { kind: 'error'; message: string; at: number };

export type ScreenDiagnosticsStore = {
  get: (artifactId: string) => ScreenDiagnostic[];
  push: (artifactId: string, diagnostic: ScreenDiagnostic) => void;
  clear: (artifactId: string) => void;
  /** Snapshot for harness / agent-facing read model (live session only). */
  snapshot: () => Record<string, ScreenDiagnostic[]>;
  subscribe: (listener: () => void) => () => void;
};

const EMPTY_DIAGNOSTICS: ScreenDiagnostic[] = [];

export function createScreenDiagnosticsStore(): ScreenDiagnosticsStore {
  const byArtifact = new Map<string, ScreenDiagnostic[]>();
  const listeners = new Set<() => void>();
  let cachedSnapshot: Record<string, ScreenDiagnostic[]> = {};
  let snapshotDirty = true;

  const notify = () => {
    snapshotDirty = true;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    get(artifactId) {
      return byArtifact.get(artifactId) ?? EMPTY_DIAGNOSTICS;
    },
    push(artifactId, diagnostic) {
      const existing = byArtifact.get(artifactId) ?? [];
      byArtifact.set(artifactId, [...existing, diagnostic]);
      notify();
    },
    clear(artifactId) {
      if (!byArtifact.has(artifactId)) {
        return;
      }
      byArtifact.delete(artifactId);
      notify();
    },
    snapshot() {
      if (!snapshotDirty) {
        return cachedSnapshot;
      }
      const out: Record<string, ScreenDiagnostic[]> = {};
      for (const [id, list] of byArtifact) {
        out[id] = list;
      }
      cachedSnapshot = out;
      snapshotDirty = false;
      return cachedSnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function parseFrameDiagnostic(data: unknown): ScreenDiagnostic | null {
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const msg = data as { kind?: string; directive?: string; blockedUri?: string; message?: string };
  const at = Date.now();
  if (msg.kind === 'plandesk:blocked') {
    if (typeof msg.directive !== 'string' || typeof msg.blockedUri !== 'string') {
      return null;
    }
    return { kind: 'blocked', directive: msg.directive, blockedUri: msg.blockedUri, at };
  }
  if (msg.kind === 'plandesk:error') {
    if (typeof msg.message !== 'string') {
      return null;
    }
    return { kind: 'error', message: msg.message, at };
  }
  return null;
}
