import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_CANVAS_MODE, type CanvasMode } from './canvas-mode.js';
import { useFrameRegistry } from './FrameRegistryContext.js';

type CanvasModeContextValue = {
  mode: CanvasMode;
  setMode: (mode: CanvasMode) => void;
};

const CanvasModeContext = createContext<CanvasModeContextValue | null>(null);

/**
 * Owns the canvas gesture mode and posts `plandesk:mode` into every live frame
 * whenever the mode changes — without remounting frames.
 */
export function CanvasModeProvider({ children }: { children: ReactNode }) {
  const { registry } = useFrameRegistry();
  const [mode, setModeState] = useState<CanvasMode>(DEFAULT_CANVAS_MODE);

  const setMode = useCallback(
    (next: CanvasMode) => {
      setModeState(next);
      registry.broadcast({ kind: 'plandesk:mode', mode: next });
    },
    [registry],
  );

  // On first mount (and if frames register later), keep shim in sync with shell.
  useEffect(() => {
    registry.broadcast({ kind: 'plandesk:mode', mode });
  }, [registry, mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <CanvasModeContext.Provider value={value}>{children}</CanvasModeContext.Provider>;
}

export function useCanvasMode(): CanvasModeContextValue {
  const ctx = useContext(CanvasModeContext);
  if (ctx === null) {
    throw new Error('useCanvasMode must be used within CanvasModeProvider');
  }
  return ctx;
}
