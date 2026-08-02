import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate } from '@tanstack/react-router';
import { LayoutDashboard, Maximize, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/docs/ConfirmDialog.js';
import { layoutNodes } from '@/components/canvas/layout.js';
import { getArtifact } from '@/lib/api.js';
import { usePatchArtifact, usePrototype, usePrototypes } from '@/lib/queries.js';
import type {
  CommentTarget,
  SerializedPrototypeBoundaryLink,
  SerializedPrototypeLink,
  SerializedPrototypeWithScreens,
} from '@/lib/api.js';
import { CanvasModeProvider, useCanvasMode } from './CanvasModeContext.js';
import { CommentPinsLayer } from './CommentPins.js';
import { FrameRegistryProvider, useFrameRegistry } from './FrameRegistryContext.js';
import { resolveNavigate } from './navigate-target.js';
import { PrototypeChrome } from './PrototypeChrome.js';
import { PrototypeCommentsRail } from './PrototypeCommentsRail.js';
import { ScreenCommentsProvider } from './ScreenCommentsContext.js';
import { ScreenDiagnosticsProvider, useDiagnosticsSnapshot } from './ScreenDiagnosticsContext.js';
import { ScreenNode, type ScreenNodeData } from './ScreenNode.js';
import { BoundaryMarkerNode, type BoundaryMarkerData } from './BoundaryMarkerNode.js';
import type { CanvasMode } from './canvas-mode.js';

const nodeTypes = { screenFrame: ScreenNode, boundaryMarker: BoundaryMarkerNode };

function brokenTargetsFor(artifactId: string, links: SerializedPrototypeLink[]): string[] {
  return links
    .filter((link) => link.from_artifact_id === artifactId && link.to_artifact_id === null)
    .map((link) => link.raw_target);
}

function boundaryNodeId(link: SerializedPrototypeBoundaryLink): string {
  return `boundary:${link.direction}:${link.link_id}`;
}

export function prototypeToFlow(
  prototype: SerializedPrototypeWithScreens,
  options: { frameToken?: string; readOnly?: boolean } = {},
): {
  nodes: Node<ScreenNodeData | BoundaryMarkerData>[];
  edges: Edge[];
} {
  const { viewport_width: width, viewport_height: height, project_id: projectId } = prototype;
  const screenIds = new Set(prototype.screens.map((s) => s.id));
  const nodes: Node<ScreenNodeData | BoundaryMarkerData>[] = prototype.screens.map((screen) => ({
    id: screen.id,
    type: 'screenFrame',
    position: { x: screen.x ?? 0, y: screen.y ?? 0 },
    width,
    height,
    style: { width, height },
    data: {
      artifactId: screen.id,
      title: screen.title,
      revisionId: screen.revision_id,
      width,
      height,
      projectId,
      prototypeId: prototype.id,
      ...(options.frameToken !== undefined ? { frameToken: options.frameToken } : {}),
      ...(options.readOnly === true ? { readOnly: true } : {}),
      brokenLinks: brokenTargetsFor(screen.id, prototype.links),
    },
  }));

  const edges: Edge[] = [];
  for (const link of prototype.links) {
    if (link.to_artifact_id === null) {
      continue;
    }
    if (!screenIds.has(link.to_artifact_id)) {
      // Cross-boundary exit is drawn via boundary_links, not a dangling RF edge.
      continue;
    }
    edges.push({
      id: link.id,
      source: link.from_artifact_id,
      target: link.to_artifact_id,
      type: 'default',
    });
  }

  for (const boundary of prototype.boundary_links) {
    const markerId = boundaryNodeId(boundary);
    const local = prototype.screens.find((s) => s.id === boundary.local_artifact_id);
    const localX = local?.x ?? 0;
    const localY = local?.y ?? 0;
    const offsetX = boundary.direction === 'exit' ? width + 48 : -220;
    nodes.push({
      id: markerId,
      type: 'boundaryMarker',
      position: { x: localX + offsetX, y: localY + height / 2 - 28 },
      draggable: false,
      selectable: true,
      data: {
        direction: boundary.direction,
        foreignTitle: boundary.foreign_title,
        foreignPrototypeId: boundary.foreign_prototype_id,
        foreignPrototypeName: boundary.foreign_prototype_name,
        foreignArtifactId: boundary.foreign_artifact_id,
        projectId,
      },
    });
    if (boundary.direction === 'exit') {
      edges.push({
        id: `boundary-edge:${boundary.link_id}`,
        source: boundary.local_artifact_id,
        target: markerId,
        type: 'default',
        label: `exits to ${boundary.foreign_prototype_name}`,
      });
    } else {
      edges.push({
        id: `boundary-edge:${boundary.link_id}`,
        source: markerId,
        target: boundary.local_artifact_id,
        type: 'default',
        label: `arrives from ${boundary.foreign_prototype_name}`,
      });
    }
  }

  return { nodes, edges };
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left">
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => {
            void zoomIn({ duration: 200 });
          }}
        >
          <Plus />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => {
            void zoomOut({ duration: 200 });
          }}
        >
          <Minus />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fit view"
          onClick={() => {
            void fitView({ padding: 0.2, duration: 300 });
          }}
        >
          <Maximize />
        </Button>
      </div>
    </Panel>
  );
}

function RelayoutPanel({ onRelayout }: { onRelayout: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { fitView } = useReactFlow();
  return (
    <>
      <Panel position="top-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-relayout
          onClick={() => {
            setConfirmOpen(true);
          }}
        >
          <LayoutDashboard /> Auto layout
        </Button>
      </Panel>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Auto layout?"
        description="Auto-layout repositions every screen. Your manual arrangement will be replaced. Continue?"
        confirmLabel="Continue"
        onConfirm={() => {
          onRelayout();
          void fitView({ padding: 0.2, duration: 300 });
          setConfirmOpen(false);
        }}
      />
    </>
  );
}

type PrototypeCanvasOptions = {
  prototype?: SerializedPrototypeWithScreens;
  readOnly?: boolean;
  guestModes?: readonly CanvasMode[];
  frameToken?: string;
  commentTargetForArtifact?: (artifactId: string) => CommentTarget;
};

function PrototypeCanvasInner({
  prototypeId,
  prototype: suppliedPrototype,
  readOnly = false,
  guestModes,
  frameToken,
  commentTargetForArtifact,
}: { prototypeId: string } & PrototypeCanvasOptions) {
  const {
    data: fetchedPrototype,
    isLoading,
    error,
  } = usePrototype(prototypeId, { enabled: suppliedPrototype === undefined });
  const prototype = suppliedPrototype ?? fetchedPrototype;
  const patchArtifact = usePatchArtifact(prototypeId);
  const { acceptedCount, lastAccepted, setNavigateHandler } = useFrameRegistry();
  const { mode } = useCanvasMode();
  const diagnosticsSnapshot = useDiagnosticsSnapshot();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ScreenNodeData | BoundaryMarkerData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const { setCenter, getNode } = useReactFlow();
  const navigate = useNavigate();
  const setNodesRef = useRef(setNodes);
  setNodesRef.current = setNodes;

  useEffect(() => {
    if (prototype === undefined) {
      return;
    }
    const mapped = prototypeToFlow(prototype, { frameToken, readOnly });
    setNodes(mapped.nodes);
    setEdges(mapped.edges);
  }, [prototype, frameToken, readOnly, setNodes, setEdges]);

  useEffect(() => {
    if (prototype === undefined) {
      return;
    }
    const handler = (sourceArtifactId: string, rawTarget: string) => {
      void (async () => {
        let outcome = resolveNavigate(
          sourceArtifactId,
          rawTarget,
          prototype.links,
          prototype.screens,
          prototype.id,
        );

        // Destination may live on another prototype (move) — look it up.
        if (outcome.kind === 'go' && !readOnly) {
          const targetId = outcome.artifactId;
          const destProto = outcome.prototypeId;
          const onThisCanvas = prototype.screens.some((s) => s.id === targetId);
          if (!onThisCanvas || destProto === null) {
            try {
              const art = await getArtifact(targetId);
              outcome = {
                kind: 'go',
                artifactId: art.id,
                prototypeId: art.prototype_id,
              };
            } catch {
              toast(`No screen matches ${rawTarget}`);
              return;
            }
          }
        }

        if (outcome.kind === 'broken' || outcome.kind === 'unresolved') {
          toast(outcome.reason);
          return;
        }

        const { artifactId, prototypeId: destPrototypeId } = outcome;

        if (destPrototypeId !== null && destPrototypeId !== prototype.id) {
          void navigate({
            to: '/projects/$id/prototypes/$prototypeId',
            params: {
              id: prototype.project_id,
              prototypeId: destPrototypeId,
            },
            replace: true,
          });
          return;
        }

        const node = getNode(artifactId);
        if (node === undefined) {
          toast('Screen is not on this canvas');
          return;
        }
        const width = typeof node.width === 'number' ? node.width : prototype.viewport_width;
        const height = typeof node.height === 'number' ? node.height : prototype.viewport_height;
        void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          zoom: 0.6,
          duration: 400,
        });
        setNodesRef.current((current) =>
          current.map((n) => ({ ...n, selected: n.id === artifactId })),
        );
      })();
    };

    setNavigateHandler(handler);
    return () => {
      setNavigateHandler(null);
    };
  }, [prototype, readOnly, setNavigateHandler, setCenter, getNode, navigate]);

  const handleRelayout = useCallback(() => {
    setNodes((current) => {
      const arranged = layoutNodes(current, edges);
      for (const node of arranged) {
        patchArtifact.mutate({
          id: node.id,
          input: { x: node.position.x, y: node.position.y },
        });
      }
      return arranged;
    });
  }, [edges, patchArtifact, setNodes]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      patchArtifact.mutate({
        id: node.id,
        input: { x: node.position.x, y: node.position.y },
      });
    },
    [patchArtifact],
  );

  if (suppliedPrototype === undefined && isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading prototype…</p>;
  }
  if (suppliedPrototype === undefined && error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Failed to load prototype: {error.message}
      </p>
    );
  }
  if (prototype === undefined) {
    return <p className="p-4 text-sm">Prototype not found.</p>;
  }

  const diagnosticTotal = Object.values(diagnosticsSnapshot).reduce(
    (n, list) => n + list.length,
    0,
  );
  const screenNodes = nodes.filter(
    (node): node is Node<ScreenNodeData> => node.type === 'screenFrame',
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-prototype-canvas
      data-prototype-id={prototypeId}
      data-canvas-mode={mode}
      data-accepted-frame-messages={acceptedCount}
      data-last-accepted-artifact={lastAccepted?.artifactId ?? ''}
      data-viewport-width={prototype.viewport_width}
      data-viewport-height={prototype.viewport_height}
      data-diagnostic-total={diagnosticTotal}
      data-runtime-diagnostics={JSON.stringify(diagnosticsSnapshot)}
    >
      <PrototypeChrome
        prototypeId={prototype.id}
        name={prototype.name}
        coverage={prototype.coverage}
        readOnly={readOnly}
        {...(guestModes !== undefined ? { modes: guestModes } : {})}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            {...(!readOnly ? { onNodeDragStop: handleNodeDragStop } : {})}
            nodeTypes={nodeTypes}
            onlyRenderVisibleElements
            minZoom={0.05}
            maxZoom={2}
            defaultViewport={{ x: 40, y: 40, zoom: 0.45 }}
            panOnDrag
            panActivationKeyCode="Space"
            nodesDraggable={!readOnly && mode === 'arrange'}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <MiniMap pannable zoomable className="!bg-card" />
            <ZoomControls />
            {!readOnly ? <RelayoutPanel onRelayout={handleRelayout} /> : null}
            {guestModes?.includes('comment') !== false ? (
              <CommentPinsLayer
                projectId={prototype.project_id}
                screens={screenNodes.map((n) => ({
                  artifactId: n.data.artifactId,
                  position: n.position,
                  revisionId: n.data.revisionId,
                }))}
              />
            ) : null}
          </ReactFlow>
        </div>
        {guestModes?.includes('comment') !== false ? (
          <PrototypeCommentsRail
            projectId={prototype.project_id}
            defaultArtifactId={screenNodes[0]?.data.artifactId ?? null}
            commentTargetForArtifact={commentTargetForArtifact}
            canManage={!readOnly}
          />
        ) : null}
      </div>
    </div>
  );
}

function PrototypeProviders({
  children,
  initialMode,
}: {
  children: ReactNode;
  initialMode?: CanvasMode;
}) {
  return (
    <ScreenDiagnosticsProvider>
      <ScreenCommentsProvider>
        <FrameRegistryProvider>
          <CanvasModeProvider initialMode={initialMode}>
            <ReactFlowProvider>{children}</ReactFlowProvider>
          </CanvasModeProvider>
        </FrameRegistryProvider>
      </ScreenCommentsProvider>
    </ScreenDiagnosticsProvider>
  );
}

export function PrototypeCanvas({
  prototypeId,
  prototype,
  readOnly,
  guestModes,
  frameToken,
  commentTargetForArtifact,
}: { prototypeId: string } & PrototypeCanvasOptions) {
  const initialMode = guestModes?.[0];
  return (
    <PrototypeProviders initialMode={initialMode}>
      <PrototypeCanvasInner
        prototypeId={prototypeId}
        prototype={prototype}
        readOnly={readOnly}
        guestModes={guestModes}
        frameToken={frameToken}
        commentTargetForArtifact={commentTargetForArtifact}
      />
    </PrototypeProviders>
  );
}

export function PrototypePicker({ projectId }: { projectId: string }) {
  const { data: prototypes, isLoading, error } = usePrototypes(projectId);

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading prototypes…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Failed to load prototypes: {error.message}
      </p>
    );
  }

  const list = prototypes ?? [];

  return (
    <div className="mx-auto max-w-2xl p-6" data-prototype-picker>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Prototypes</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Open a prototype canvas to walk its screens.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prototypes in this project yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((proto) => (
            <li key={proto.id}>
              <Link
                to="/projects/$id/prototypes/$prototypeId"
                params={{ id: projectId, prototypeId: proto.id }}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                data-prototype-link={proto.id}
              >
                <span className="font-medium">{proto.name}</span>
                <span className="text-xs text-muted-foreground">
                  {proto.viewport_width}×{proto.viewport_height}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
