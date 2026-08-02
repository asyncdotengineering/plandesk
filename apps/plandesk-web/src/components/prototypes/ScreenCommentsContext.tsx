import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  createScreenCommentsStore,
  type PendingAnchorDraft,
  type ScreenCommentsStore,
} from './screen-comments.js';

const ScreenCommentsContext = createContext<ScreenCommentsStore | null>(null);

export function ScreenCommentsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createScreenCommentsStore(), []);
  return <ScreenCommentsContext.Provider value={store}>{children}</ScreenCommentsContext.Provider>;
}

export function useScreenCommentsStore(): ScreenCommentsStore {
  const store = useContext(ScreenCommentsContext);
  if (store === null) {
    throw new Error('useScreenCommentsStore must be used within ScreenCommentsProvider');
  }
  return store;
}

export function useFrameText(artifactId: string): string | undefined {
  const store = useScreenCommentsStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getFrameText(artifactId),
    () => store.getFrameText(artifactId),
  );
}

export function usePendingAnchor(): PendingAnchorDraft | null {
  const store = useScreenCommentsStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getPending(),
    () => store.getPending(),
  );
}
