import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { SerializedPrototypeWithScreens } from '@/lib/api.js';
import { artifactRenderSrc } from '@/lib/artifact-frame.js';
import {
  FrameRegistryProvider,
  useFrameRegistry,
  useRegisterFrame,
} from './FrameRegistryContext.js';
import { resolveNavigate } from './navigate-target.js';
import { fitScale, stepIndex } from './present-scale.js';
import { ScreenCommentsProvider } from './ScreenCommentsContext.js';
import { ScreenDiagnosticsProvider } from './ScreenDiagnosticsContext.js';

export type PresentStageProps = {
  prototype: SerializedPrototypeWithScreens;
  screenId: string;
  frameToken?: string;
  onGoToScreen: (screenId: string) => void;
  onExit: () => void;
};

/**
 * Preview mode: one screen, scaled to fit, with clicks following the flow.
 *
 * The canvas answers "how do these screens connect"; this answers "what is it
 * like to use". They are different questions, so this is a route rather than a
 * canvas state — the URL names the screen, which makes a walkthrough something
 * you can send to a reviewer and something a refresh keeps.
 *
 * Frames stay under the same sandbox they use on the canvas. The stage tells
 * each one it is in `interact` mode, which is the shim's gate for following a
 * `plandesk://` link.
 */
export function PresentStage(props: PresentStageProps) {
  return (
    <ScreenDiagnosticsProvider>
      <ScreenCommentsProvider>
        <FrameRegistryProvider>
          <PresentStageInner {...props} />
        </FrameRegistryProvider>
      </ScreenCommentsProvider>
    </ScreenDiagnosticsProvider>
  );
}

function PresentStageInner({
  prototype,
  screenId,
  frameToken,
  onGoToScreen,
  onExit,
}: PresentStageProps) {
  const { setNavigateHandler, acceptedCount } = useFrameRegistry();
  const setIframeRef = useRegisterFrame(screenId);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });

  const screens = prototype.screens;
  const index = screens.findIndex((candidate) => candidate.id === screenId);
  const screen = index >= 0 ? screens[index] : undefined;

  const goToIndex = useCallback(
    (next: number) => {
      const target = screens[next];
      if (target !== undefined && target.id !== screenId) {
        onGoToScreen(target.id);
      }
    },
    [screens, screenId, onGoToScreen],
  );

  useEffect(() => {
    setNavigateHandler((sourceArtifactId, rawTarget) => {
      const outcome = resolveNavigate(
        sourceArtifactId,
        rawTarget,
        prototype.links,
        prototype.screens,
        prototype.id,
      );
      if (outcome.kind !== 'go') {
        toast(outcome.reason);
        return;
      }
      // A boundary link leaves this flow. Preview walks one prototype, so say
      // so rather than navigating to a screen the stage cannot step back from.
      if (!prototype.screens.some((candidate) => candidate.id === outcome.artifactId)) {
        toast('That link leaves this prototype — open it on the canvas.');
        return;
      }
      onGoToScreen(outcome.artifactId);
    });
    return () => {
      setNavigateHandler(null);
    };
  }, [prototype, setNavigateHandler, onGoToScreen]);

  useEffect(() => {
    const element = stageRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect !== undefined) {
        setAvailable({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Keys land on the shell, not inside the sandboxed frame — a cross-origin
  // frame keeps its own keystrokes. The visible controls below are what a
  // reviewer whose pointer is over the screen actually uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onExit();
        return;
      }
      if (event.key === 'ArrowRight') {
        goToIndex(stepIndex(index, 1, screens.length));
        return;
      }
      if (event.key === 'ArrowLeft') {
        goToIndex(stepIndex(index, -1, screens.length));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [index, screens.length, goToIndex, onExit]);

  const { viewport_width: width, viewport_height: height } = prototype;
  const scale = useMemo(() => fitScale(available, { width, height }), [available, width, height]);
  // The frame waits one frame for the stage to be measured. Mounting before
  // then means mounting at scale 1 and jumping to the fitted scale a tick
  // later — a visible resize of the screen under review, and a frame whose box
  // moves under a pointer that is already over it.
  const measured = available.width > 0 && available.height > 0;

  const bindIframe = useCallback(
    (node: HTMLIFrameElement | null) => {
      setIframeRef(node);
      if (node === null) {
        return;
      }
      const post = () => {
        node.contentWindow?.postMessage({ kind: 'plandesk:mode', mode: 'interact' }, '*');
      };
      node.addEventListener('load', post, { once: true });
      post();
    },
    [setIframeRef],
  );

  if (screen === undefined) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-950 text-sm text-neutral-400">
        <p role="alert">That screen is not in this prototype.</p>
        <button
          type="button"
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800"
          onClick={onExit}
        >
          Back to the canvas
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col bg-neutral-950"
      data-present-stage
      data-artifact-id={screen.id}
      data-present-index={index + 1}
      data-present-total={screens.length}
      data-present-scale={scale.toFixed(3)}
      data-accepted-frame-messages={acceptedCount}
    >
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center p-6">
        {/* The outer box carries the SCALED size so flex centring stays honest;
            an unscaled box would keep its full footprint and push the screen
            off-centre exactly when the window is too small. */}
        <div
          className="relative overflow-hidden rounded-lg bg-white shadow-2xl"
          style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
        >
          {measured ? (
            <iframe
              key={`${screen.id}:${screen.revision_id}`}
              ref={bindIframe}
              title={screen.title}
              sandbox="allow-scripts"
              src={artifactRenderSrc(screen.id, screen.revision_id, frameToken)}
              className="border-0 bg-white"
              style={{
                width,
                height,
                transform: `scale(${String(scale)})`,
                transformOrigin: 'top left',
              }}
              data-present-frame
              data-artifact-id={screen.id}
            />
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
        <div
          data-present-bar
          className="pointer-events-auto flex items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-900/90 p-1 text-neutral-200 shadow-lg backdrop-blur-md"
        >
          <StepButton
            label="Previous screen"
            disabled={index <= 0}
            onClick={() => {
              goToIndex(stepIndex(index, -1, screens.length));
            }}
          >
            <ChevronLeftIcon className="size-4" />
          </StepButton>
          <StepButton
            label="Next screen"
            disabled={index >= screens.length - 1}
            onClick={() => {
              goToIndex(stepIndex(index, 1, screens.length));
            }}
          >
            <ChevronRightIcon className="size-4" />
          </StepButton>
          <span className="max-w-56 truncate px-2 text-xs font-medium">{screen.title}</span>
          <span className="px-1 text-xs text-neutral-400 tabular-nums">
            {index + 1}/{screens.length}
          </span>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-neutral-700" />
          <button
            type="button"
            data-present-exit
            aria-label="Exit preview"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white"
            onClick={onExit}
          >
            <XIcon className="size-3.5" />
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:pointer-events-none disabled:opacity-35"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
