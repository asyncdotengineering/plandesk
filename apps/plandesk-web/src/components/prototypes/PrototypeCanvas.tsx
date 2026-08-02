import { useCallback, useEffect, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link } from '@tanstack/react-router';
import { LayoutDashboard, Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/docs/ConfirmDialog.js';
import { layoutNodes } from '@/components/canvas/layout.js';
import { usePatchArtifact, usePrototype, usePrototypes } from '@/lib/queries.js';
import type { SerializedPrototypeLink, SerializedPrototypeWithScreens } from '@/lib/api.js';
import { FrameRegistryProvider, useFrameRegistry } from './FrameRegistryContext.js';
import { PrototypeChrome } from './PrototypeChrome.js';
import { ScreenNode, type ScreenNodeData } from './ScreenNode.js';

const nodeTypes = { screenFrame: ScreenNode };

function brokenTargetsFor(artifactId: string, links: SerializedPrototypeLink[]): string[] {
  return links
    .filter((link) => link.from_artifact_id === artifactId && link.to_artifact_id === null)
    .map((link) => link.raw_target);
}

export function prototypeToFlow(prototype: SerializedPrototypeWithScreens): {
  nodes: Node<ScreenNodeData>[];
  edges: Edge[];
} {
  const { viewport_width: width, viewport_height: height, project_id: projectId } = prototype;
  const nodes: Node<ScreenNodeData>[] = prototype.screens.map((screen) => ({
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
      brokenLinks: brokenTargetsFor(screen.id, prototype.links),
    },
  }));

  const edges: Edge[] = [];
  for (const link of prototype.links) {
    if (link.to_artifact_id === null) {
      continue;
    }
    edges.push({
      id: link.id,
      source: link.from_artifact_id,
      target: link.to_artifact_id,
      type: 'default',
    });
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

function PrototypeCanvasInner({ prototypeId }: { prototypeId: string }) {
  const { data: prototype, isLoading, error } = usePrototype(prototypeId);
  const patchArtifact = usePatchArtifact(prototypeId);
  const { acceptedCount, lastAccepted } = useFrameRegistry();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ScreenNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    if (prototype === undefined) {
      return;
    }
    const mapped = prototypeToFlow(prototype);
    setNodes(mapped.nodes);
    setEdges(mapped.edges);
  }, [prototype, setNodes, setEdges]);

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

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading prototype…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Failed to load prototype: {error.message}
      </p>
    );
  }
  if (prototype === undefined) {
    return <p className="p-4 text-sm">Prototype not found.</p>;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-prototype-canvas
      data-prototype-id={prototypeId}
      data-accepted-frame-messages={acceptedCount}
      data-last-accepted-artifact={lastAccepted?.artifactId ?? ''}
      data-viewport-width={prototype.viewport_width}
      data-viewport-height={prototype.viewport_height}
    >
      <PrototypeChrome prototypeId={prototype.id} name={prototype.name} />
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          onlyRenderVisibleElements
          minZoom={0.05}
          maxZoom={2}
          defaultViewport={{ x: 40, y: 40, zoom: 0.45 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <ZoomControls />
          <RelayoutPanel onRelayout={handleRelayout} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function PrototypeCanvas({ prototypeId }: { prototypeId: string }) {
  return (
    <FrameRegistryProvider>
      <PrototypeCanvasInner prototypeId={prototypeId} />
    </FrameRegistryProvider>
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
