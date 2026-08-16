import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasMode } from './CanvasModeContext.js';
import { useRegisterFrame } from './FrameRegistryContext.js';
import { useScreenCommentsStore } from './ScreenCommentsContext.js';
import { useScreenDiagnostics, useScreenDiagnosticsStore } from './ScreenDiagnosticsContext.js';
import { ScreenMoveCopyMenu } from './ScreenMoveCopyMenu.js';
import { artifactRenderSrc } from '../../lib/artifact-frame.js';

export type ScreenNodeData = {
  artifactId: string;
  title: string;
  revisionId: string;
  width: number;
  height: number;
  projectId: string;
  prototypeId: string;
  /** Share or render token for portal guests / Moment B — appended as ?token=. */
  frameToken?: string;
  /** Raw targets of links with a null to_artifact_id — rendered as broken stubs. */
  brokenLinks: string[];
  /** Hide move/copy chrome (portal read-only). */
  readOnly?: boolean;
  [key: string]: unknown;
};

/**
 * Prototype screen node: fixed to the prototype viewport size. Mounts a
 * sandboxed iframe only while intersecting the canvas viewport; otherwise a
 * title poster. Never allow-same-origin.
 *
 * Pointer routing is mode-owned: Arrange makes the frame inert so the node
 * drags from the body; Interact/Comment put nodrag/nopan on the frame wrapper.
 * The title strip stays pointer-events-none so Arrange drag still works there.
 */
export function ScreenNode({ data }: NodeProps<Node<ScreenNodeData>>) {
  const setIframeRef = useRegisterFrame(data.artifactId);
  const { mode } = useCanvasMode();
  const diagnostics = useScreenDiagnostics(data.artifactId);
  const diagnosticsStore = useScreenDiagnosticsStore();
  const commentsStore = useScreenCommentsStore();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeElRef = useRef<HTMLIFrameElement | null>(null);
  const [inView, setInView] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const prevRevisionRef = useRef(data.revisionId);

  useEffect(() => {
    const el = wrapperRef.current;
    if (el === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setInView(entry?.isIntersecting === true);
      },
      { root: null, threshold: 0.05 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Clear diagnostics + frame text when the revision (frame src key) changes — remount.
  useEffect(() => {
    if (prevRevisionRef.current !== data.revisionId) {
      diagnosticsStore.clear(data.artifactId);
      commentsStore.clearFrame(data.artifactId);
      prevRevisionRef.current = data.revisionId;
      setBadgeOpen(false);
    }
  }, [data.revisionId, data.artifactId, diagnosticsStore, commentsStore]);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Post the shell's mode into the frame whenever mode changes — without
  // remounting (src stays keyed on revision only).
  useEffect(() => {
    const node = iframeElRef.current;
    if (node === null) {
      return;
    }
    node.contentWindow?.postMessage({ kind: 'plandesk:mode', mode }, '*');
  }, [mode, inView, data.revisionId]);

  const bindIframe = useCallback(
    (node: HTMLIFrameElement | null) => {
      setIframeRef(node);
      iframeElRef.current = node;
      if (node === null) {
        return;
      }
      const post = () => {
        node.contentWindow?.postMessage({ kind: 'plandesk:mode', mode: modeRef.current }, '*');
      };
      node.addEventListener('load', post, { once: true });
      post();
    },
    [setIframeRef],
  );

  const frameLive = mode !== 'arrange';
  const blocked = diagnostics.filter((d) => d.kind === 'blocked');
  const errors = diagnostics.filter((d) => d.kind === 'error');

  return (
    <div
      ref={wrapperRef}
      data-screen-node
      data-artifact-id={data.artifactId}
      data-revision-id={data.revisionId}
      data-canvas-mode={mode}
      data-diagnostic-count={diagnostics.length}
      className="relative overflow-hidden rounded-md border border-border bg-card shadow-sm"
      style={{ width: data.width, height: data.height }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--border-strong)]" />
      {/* Title stays inert so Arrange drag falls through to the node wrapper. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 truncate border-b border-border/60 bg-card/90 px-2 py-1 text-[11px] font-medium">
        {data.title}
      </div>
      {mode === 'arrange' && data.readOnly !== true ? (
        <ScreenMoveCopyMenu
          artifactId={data.artifactId}
          projectId={data.projectId}
          currentPrototypeId={data.prototypeId}
        />
      ) : null}
      {diagnostics.length > 0 ? (
        <div className="absolute right-2 top-8 z-20" data-screen-diagnostics>
          <button
            type="button"
            data-diagnostic-badge
            className="nodrag nopan rounded-full border border-amber-600/50 bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-amber-950 shadow-sm"
            onClick={() => {
              setBadgeOpen((open) => !open);
            }}
          >
            {diagnostics.length} issue{diagnostics.length === 1 ? '' : 's'}
          </button>
          {badgeOpen ? (
            <ul
              data-diagnostic-list
              className="nodrag nopan mt-1 max-w-[280px] space-y-1 rounded border border-border bg-card p-2 text-[10px] shadow-md"
            >
              {blocked.map((d, i) => (
                <li
                  key={`blocked-${String(i)}-${d.blockedUri}`}
                  data-diagnostic-kind="blocked"
                  className="rounded border border-amber-600/30 bg-amber-500/10 px-1.5 py-1 text-amber-950 dark:text-amber-100"
                >
                  <span className="font-semibold">Blocked reference</span>
                  <span className="block text-muted-foreground">
                    Runtime CSP (not the write-time scan) — {d.directive}: {d.blockedUri}
                  </span>
                </li>
              ))}
              {errors.map((d, i) => (
                <li
                  key={`error-${String(i)}-${d.message}`}
                  data-diagnostic-kind="error"
                  className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-destructive"
                >
                  <span className="font-semibold">Script error</span>
                  <span className="block">{d.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {data.brokenLinks.length > 0 ? (
        <div
          data-broken-links
          className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[90%] rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive"
          title={data.brokenLinks.join(', ')}
        >
          Broken link{data.brokenLinks.length > 1 ? 's' : ''}: {data.brokenLinks.join(', ')}
        </div>
      ) : null}
      {inView ? (
        <div
          className={
            frameLive ? 'nowheel nodrag nopan h-full w-full pt-6' : 'nowheel h-full w-full pt-6'
          }
        >
          <iframe
            ref={bindIframe}
            title={data.title}
            sandbox="allow-scripts"
            src={artifactRenderSrc(data.artifactId, data.revisionId, data.frameToken)}
            className={
              frameLive
                ? 'h-full w-full border-0 bg-white'
                : 'pointer-events-none h-full w-full border-0 bg-white'
            }
            data-screen-frame
            data-artifact-id={data.artifactId}
            data-pointer-events={frameLive ? 'auto' : 'none'}
          />
        </div>
      ) : (
        <div
          data-screen-poster
          className="flex h-full w-full items-center justify-center bg-muted/40 pt-6 text-sm text-muted-foreground"
        >
          {data.title}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--border-strong)]" />
    </div>
  );
}
