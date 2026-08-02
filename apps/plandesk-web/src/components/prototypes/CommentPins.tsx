/**
 * Comment pins overlaid on the prototype canvas. Position from node + frame
 * rect via useViewport(); counter-scale by 1/zoom so pin size stays constant.
 */
import { Panel, useViewport } from '@xyflow/react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { SerializedComment } from '@/lib/api.js';
import { useComments } from '@/lib/queries.js';
import { useFrameRegistry } from './FrameRegistryContext.js';
import { useFrameText } from './ScreenCommentsContext.js';
import { parseStoredAnchor, resolveAnchor, type ResolvedAnchor } from './resolve-anchor.js';
import type { FrameRect } from './screen-comments.js';

export type ScreenPinLayout = {
  artifactId: string;
  position: { x: number; y: number };
  revisionId: string;
};

type PinView = {
  commentId: string;
  artifactId: string;
  resolution: ResolvedAnchor;
  rect: FrameRect | null;
};

function pinStyle(
  nodePos: { x: number; y: number },
  rect: FrameRect,
  viewport: { x: number; y: number; zoom: number },
): CSSProperties {
  const worldX = nodePos.x + rect.x;
  const worldY = nodePos.y + rect.y;
  return {
    position: 'absolute',
    left: worldX * viewport.zoom + viewport.x,
    top: worldY * viewport.zoom + viewport.y,
    transform: `scale(${String(1 / viewport.zoom)})`,
    transformOrigin: '0 0',
    zIndex: 20,
  };
}

function orphanStyle(
  nodePos: { x: number; y: number },
  viewport: { x: number; y: number; zoom: number },
): CSSProperties {
  const worldX = nodePos.x + 8;
  const worldY = nodePos.y + 28;
  return {
    position: 'absolute',
    left: worldX * viewport.zoom + viewport.x,
    top: worldY * viewport.zoom + viewport.y,
    transform: `scale(${String(1 / viewport.zoom)})`,
    transformOrigin: '0 0',
    zIndex: 20,
  };
}

function PinMarker({ resolution, style }: { resolution: ResolvedAnchor; style: CSSProperties }) {
  const orphan = resolution.status === 'orphan';
  const stale = resolution.stale;
  return (
    <div
      data-comment-pin
      data-pin-status={resolution.status}
      data-pin-stale={stale ? 'true' : 'false'}
      className={
        orphan
          ? 'pointer-events-none rounded-full border border-amber-700 bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950 shadow'
          : stale
            ? 'pointer-events-none size-3 rounded-full border-2 border-amber-600 bg-amber-300 shadow'
            : 'pointer-events-none size-3 rounded-full border-2 border-sky-700 bg-sky-400 shadow'
      }
      style={style}
    >
      {orphan ? 'Orphaned' : null}
    </div>
  );
}

function requestHighlightRect(
  contentWindow: Window,
  start: number,
  end: number,
): Promise<FrameRect | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 2000);
    const handler = (event: MessageEvent) => {
      if (event.source !== contentWindow) {
        return;
      }
      const raw: unknown = event.data;
      if (raw === null || typeof raw !== 'object') {
        return;
      }
      const data = raw as { kind?: string; rect?: FrameRect | null };
      if (data.kind !== 'plandesk:rect') {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener('message', handler);
      resolve(data.rect ?? null);
    };
    window.addEventListener('message', handler);
    contentWindow.postMessage({ kind: 'plandesk:highlight', start, end }, '*');
  });
}

function ArtifactCommentPins({
  layout,
  projectId,
}: {
  layout: ScreenPinLayout;
  projectId: string;
}) {
  const viewport = useViewport();
  const frameText = useFrameText(layout.artifactId);
  const { registry } = useFrameRegistry();
  const { data: comments } = useComments({
    type: 'artifact',
    id: layout.artifactId,
    projectId,
  });
  const [rects, setRects] = useState<Record<string, FrameRect | null>>({});

  const anchored = (comments ?? []).flatMap((c) => {
    const selector = parseStoredAnchor(c.anchor);
    if (selector === null) {
      return [];
    }
    return [{ comment: c, selector }];
  });

  const commentKey = (comments ?? []).map((c) => `${c.id}:${c.anchor ?? ''}`).join('|');

  useEffect(() => {
    const iframe = registry.iframeFor(layout.artifactId);
    const contentWindow = iframe?.contentWindow ?? null;
    if (contentWindow === null) {
      return;
    }

    const currentAnchored = (comments ?? []).flatMap((c) => {
      const selector = parseStoredAnchor(c.anchor);
      if (selector === null) {
        return [];
      }
      return [{ comment: c, selector }];
    });

    const pointRects: Record<string, FrameRect> = {};
    const textPending: Array<{ id: string; start: number; end: number }> = [];

    for (const { comment, selector } of currentAnchored) {
      const resolution = resolveAnchor(frameText, selector, layout.revisionId);
      if (resolution.status === 'resolved') {
        textPending.push({ id: comment.id, start: resolution.start, end: resolution.end });
      } else if (resolution.status === 'point') {
        pointRects[comment.id] = {
          x: resolution.x,
          y: resolution.y,
          width: 0,
          height: 0,
        };
      }
    }

    if (Object.keys(pointRects).length > 0) {
      setRects((prev) => ({ ...prev, ...pointRects }));
    }

    if (textPending.length === 0) {
      return;
    }

    const run = { cancelled: false };
    void (async () => {
      for (const item of textPending) {
        if (run.cancelled) {
          return;
        }
        const rect = await requestHighlightRect(contentWindow, item.start, item.end);
        setRects((prev) => (run.cancelled ? prev : { ...prev, [item.id]: rect }));
      }
    })();

    return () => {
      run.cancelled = true;
    };
  }, [frameText, layout.artifactId, layout.revisionId, commentKey, registry, comments]);

  const pins: PinView[] = anchored.map(({ comment, selector }) => {
    const resolution = resolveAnchor(frameText, selector, layout.revisionId);
    return {
      commentId: comment.id,
      artifactId: layout.artifactId,
      resolution,
      rect: rects[comment.id] ?? null,
    };
  });

  return (
    <>
      {pins.map((pin) => {
        if (pin.resolution.status === 'pending') {
          return null;
        }
        if (pin.resolution.status === 'orphan') {
          return (
            <PinMarker
              key={pin.commentId}
              resolution={pin.resolution}
              style={orphanStyle(layout.position, viewport)}
            />
          );
        }
        const rect =
          pin.rect ??
          (pin.resolution.status === 'point'
            ? { x: pin.resolution.x, y: pin.resolution.y, width: 0, height: 0 }
            : null);
        if (rect === null) {
          return null;
        }
        return (
          <PinMarker
            key={pin.commentId}
            resolution={pin.resolution}
            style={pinStyle(layout.position, rect, viewport)}
          />
        );
      })}
    </>
  );
}

export function CommentPinsLayer({
  projectId,
  screens,
}: {
  projectId: string;
  screens: ScreenPinLayout[];
}) {
  return (
    <Panel
      position="top-left"
      className="pointer-events-none !m-0 !h-full !w-full !transform-none overflow-hidden"
      data-comment-pins
    >
      <div className="pointer-events-none absolute inset-0">
        {screens.map((layout) => (
          <ArtifactCommentPins key={layout.artifactId} layout={layout} projectId={projectId} />
        ))}
      </div>
    </Panel>
  );
}

/** Pure helper for pin CSS — unit-tested without React Flow. */
export function computePinStyle(
  nodePos: { x: number; y: number },
  rect: FrameRect,
  viewport: { x: number; y: number; zoom: number },
): { left: number; top: number; transform: string } {
  const style = pinStyle(nodePos, rect, viewport);
  return {
    left: style.left as number,
    top: style.top as number,
    transform: style.transform as string,
  };
}

export type { SerializedComment };
