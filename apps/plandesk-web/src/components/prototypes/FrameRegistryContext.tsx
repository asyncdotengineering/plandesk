import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createFrameRegistry, listenFrameMessages, type FrameRegistry } from './frame-registry.js';

type FrameRegistryContextValue = {
  registry: FrameRegistry;
  /** Count of accepted (registered-source) messages — harness assertions. */
  acceptedCount: number;
  lastAccepted: { artifactId: string; data: unknown } | null;
};

const FrameRegistryContext = createContext<FrameRegistryContextValue | null>(null);

export function FrameRegistryProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => createFrameRegistry(), []);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [lastAccepted, setLastAccepted] = useState<{
    artifactId: string;
    data: unknown;
  } | null>(null);

  useEffect(() => {
    return listenFrameMessages(
      registry,
      () => {
        // Mode / navigate / selection consumers land in later tasks.
      },
      (artifactId, data) => {
        setAcceptedCount((n) => n + 1);
        setLastAccepted({ artifactId, data });
      },
    );
  }, [registry]);

  const value = useMemo(
    () => ({ registry, acceptedCount, lastAccepted }),
    [registry, acceptedCount, lastAccepted],
  );

  return <FrameRegistryContext.Provider value={value}>{children}</FrameRegistryContext.Provider>;
}

export function useFrameRegistry(): FrameRegistryContextValue {
  const ctx = useContext(FrameRegistryContext);
  if (ctx === null) {
    throw new Error('useFrameRegistry must be used within FrameRegistryProvider');
  }
  return ctx;
}

export function useRegisterFrame(artifactId: string) {
  const { registry } = useFrameRegistry();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const setIframeRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      if (iframeRef.current !== null && iframeRef.current !== node) {
        registry.unregister(iframeRef.current);
      }
      iframeRef.current = node;
      if (node !== null) {
        registry.register(node, artifactId);
      }
    },
    [registry, artifactId],
  );

  useEffect(() => {
    return () => {
      if (iframeRef.current !== null) {
        registry.unregister(iframeRef.current);
      }
    };
  }, [registry]);

  return setIframeRef;
}
