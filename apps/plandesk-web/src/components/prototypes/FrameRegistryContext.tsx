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
import { parseFrameDiagnostic } from './screen-diagnostics.js';
import { useScreenDiagnosticsStore } from './ScreenDiagnosticsContext.js';

export type FrameNavigateHandler = (sourceArtifactId: string, rawTarget: string) => void;

type FrameRegistryContextValue = {
  registry: FrameRegistry;
  /** Count of accepted (registered-source) messages — harness assertions. */
  acceptedCount: number;
  lastAccepted: { artifactId: string; data: unknown } | null;
  setNavigateHandler: (handler: FrameNavigateHandler | null) => void;
};

const FrameRegistryContext = createContext<FrameRegistryContextValue | null>(null);

export function FrameRegistryProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => createFrameRegistry(), []);
  const diagnostics = useScreenDiagnosticsStore();
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [lastAccepted, setLastAccepted] = useState<{
    artifactId: string;
    data: unknown;
  } | null>(null);
  const navigateRef = useRef<FrameNavigateHandler | null>(null);

  const setNavigateHandler = useCallback((handler: FrameNavigateHandler | null) => {
    navigateRef.current = handler;
  }, []);

  useEffect(() => {
    return listenFrameMessages(
      registry,
      (artifactId, data) => {
        const diagnostic = parseFrameDiagnostic(data);
        if (diagnostic !== null) {
          diagnostics.push(artifactId, diagnostic);
          return;
        }
        if (data !== null && typeof data === 'object') {
          const msg = data as { kind?: string; target?: string };
          if (msg.kind === 'plandesk:navigate' && typeof msg.target === 'string') {
            navigateRef.current?.(artifactId, msg.target);
          }
        }
      },
      (artifactId, data) => {
        setAcceptedCount((n) => n + 1);
        setLastAccepted({ artifactId, data });
      },
    );
  }, [registry, diagnostics]);

  const value = useMemo(
    () => ({ registry, acceptedCount, lastAccepted, setNavigateHandler }),
    [registry, acceptedCount, lastAccepted, setNavigateHandler],
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
