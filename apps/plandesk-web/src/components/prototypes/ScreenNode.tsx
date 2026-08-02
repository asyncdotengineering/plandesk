import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useRegisterFrame } from './FrameRegistryContext.js';

export type ScreenNodeData = {
  artifactId: string;
  title: string;
  revisionId: string;
  width: number;
  height: number;
  projectId: string;
  /** Raw targets of links with a null to_artifact_id — rendered as broken stubs. */
  brokenLinks: string[];
  [key: string]: unknown;
};

function artifactRenderSrc(artifactId: string, revisionId: string): string {
  return `/api/v1/artifacts/${artifactId}/render?v=${encodeURIComponent(revisionId)}`;
}

/**
 * Prototype screen node: fixed to the prototype viewport size. Mounts a
 * sandboxed iframe only while intersecting the canvas viewport; otherwise a
 * title poster. Never allow-same-origin.
 */
export function ScreenNode({ data }: NodeProps<Node<ScreenNodeData>>) {
  const setIframeRef = useRegisterFrame(data.artifactId);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const modePostedRef = useRef(false);

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

  const bindIframe = (node: HTMLIFrameElement | null) => {
    setIframeRef(node);
    if (node === null) {
      modePostedRef.current = false;
      return;
    }
    // Post interact mode on every fresh mount (default until parent posts).
    if (!modePostedRef.current) {
      const post = () => {
        node.contentWindow?.postMessage({ kind: 'plandesk:mode', mode: 'interact' }, '*');
        modePostedRef.current = true;
      };
      // contentWindow is ready after load; also try immediately for cached docs.
      node.addEventListener('load', post, { once: true });
      post();
    }
  };

  return (
    <div
      ref={wrapperRef}
      data-screen-node
      data-artifact-id={data.artifactId}
      data-revision-id={data.revisionId}
      className="relative overflow-hidden rounded-md border border-border bg-card shadow-sm"
      style={{ width: data.width, height: data.height }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--border-strong)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 truncate border-b border-border/60 bg-card/90 px-2 py-1 text-[11px] font-medium">
        {data.title}
      </div>
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
        <div className="nowheel h-full w-full pt-6">
          <iframe
            ref={bindIframe}
            title={data.title}
            sandbox="allow-scripts"
            src={artifactRenderSrc(data.artifactId, data.revisionId)}
            className="h-full w-full border-0 bg-white"
            data-screen-frame
            data-artifact-id={data.artifactId}
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
