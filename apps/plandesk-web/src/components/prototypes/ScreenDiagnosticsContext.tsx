import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  createScreenDiagnosticsStore,
  type ScreenDiagnostic,
  type ScreenDiagnosticsStore,
} from './screen-diagnostics.js';

const ScreenDiagnosticsContext = createContext<ScreenDiagnosticsStore | null>(null);

export function ScreenDiagnosticsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createScreenDiagnosticsStore(), []);
  return (
    <ScreenDiagnosticsContext.Provider value={store}>{children}</ScreenDiagnosticsContext.Provider>
  );
}

export function useScreenDiagnosticsStore(): ScreenDiagnosticsStore {
  const store = useContext(ScreenDiagnosticsContext);
  if (store === null) {
    throw new Error('useScreenDiagnosticsStore must be used within ScreenDiagnosticsProvider');
  }
  return store;
}

/** Live diagnostics for one screen — agent/human read model for the current render. */
export function useScreenDiagnostics(artifactId: string): ScreenDiagnostic[] {
  const store = useScreenDiagnosticsStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(artifactId),
    () => store.get(artifactId),
  );
}

export function useDiagnosticsSnapshot(): Record<string, ScreenDiagnostic[]> {
  const store = useScreenDiagnosticsStore();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
