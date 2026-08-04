import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SubmitEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutDashboard, Maximize, Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_EDGE_LABEL, type TaskEdgeLabel } from '../../lib/api.js';
import {
  useCanvas,
  useCreateTask,
  useDeleteEdge,
  useDeleteTask,
  useDocuments,
  usePatchTask,
  useTags,
} from '../../lib/queries.js';
import { ConfirmDialog } from '../docs/ConfirmDialog.js';
import {
  buildTaskDocumentMap,
  canvasToFlowEdges,
  canvasToFlowNodes,
  type LabeledEdgeData,
  type TaskNodeData,
} from './canvas-map.js';
import { LabeledEdge } from './LabeledEdge.js';
import { layoutNodes } from './layout.js';
import { TaskDetail } from './TaskDetail.js';
import { registerTaskNodeCallbacks, TaskNode } from './TaskNode.js';
import { useCanvasSync } from './useCanvasSync.js';

const nodeTypes = { taskCard: TaskNode };
const edgeTypes = { labeled: LabeledEdge };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FlowCanvasProps = {
  projectId: string;
};

function AddTaskPanel({ projectId }: { projectId: string }) {
  const { screenToFlowPosition } = useReactFlow();
  const createTask = useCreateTask(projectId);
  const [label, setLabel] = useState('');

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === '') {
      return;
    }
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    createTask.mutate(
      {
        label: trimmed,
        status: 'todo',
        x: center.x,
        y: center.y,
      },
      {
        onSuccess: () => {
          setLabel('');
        },
      },
    );
  };

  return (
    <Panel position="top-left">
      <form
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-1 shadow-sm"
        onSubmit={handleSubmit}
      >
        <Input
          type="text"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          placeholder="New task name"
          aria-label="New task name"
          className="h-7 w-40 border-transparent bg-transparent text-[12.5px] shadow-none focus-visible:border-[var(--border-strong)]"
        />
        <Button type="submit" size="sm" disabled={createTask.isPending || label.trim() === ''}>
          {createTask.isPending ? (
            'Adding…'
          ) : (
            <>
              <Plus /> Add
            </>
          )}
        </Button>
      </form>
    </Panel>
  );
}

function ArrangePanel({ onArrange }: { onArrange: () => void }) {
  const { fitView } = useReactFlow();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Panel position="top-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
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
        description="Auto-layout repositions every node. Your manual arrangement will be replaced. Continue?"
        confirmLabel="Continue"
        onConfirm={() => {
          onArrange();
          void fitView({ padding: 0.2, duration: 300 });
          setConfirmOpen(false);
        }}
      />
    </>
  );
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

export function FlowCanvas({ projectId }: FlowCanvasProps) {
  const { data: canvas, isLoading, error } = useCanvas(projectId);
  const { data: documents } = useDocuments(projectId);
  const { data: allTags } = useTags(projectId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<LabeledEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const { bindFlowState, onNodeDragStop, saveWithState, isSaving, saveError } =
    useCanvasSync(projectId);
  const patchTask = usePatchTask();
  const deleteTask = useDeleteTask();
  const deleteEdge = useDeleteEdge(projectId);

  // Stable edge-label handler, declared before the effects that seed edges with
  // it. The ref is populated with the latest handler below, so this callback
  // keeps a constant identity (edges don't churn) while calling through to the
  // current logic. Declaring it here — ahead of the effect deps that reference
  // it — avoids a temporal-dead-zone crash on mount.
  const handleEdgeLabelChangeRef = useRef<(edgeId: string, label: TaskEdgeLabel) => void>(() => {});
  const stableOnLabelChange = useCallback((edgeId: string, label: TaskEdgeLabel) => {
    handleEdgeLabelChangeRef.current(edgeId, label);
  }, []);

  useEffect(() => {
    if (canvas === undefined) {
      return;
    }
    const taskDocumentMap = documents !== undefined ? buildTaskDocumentMap(documents) : undefined;
    setNodes(canvasToFlowNodes(canvas.nodes, { taskDocumentMap }));
    setEdges(
      canvasToFlowEdges(canvas.edges).map((edge) => ({
        ...edge,
        data: {
          label: edge.data?.label ?? DEFAULT_EDGE_LABEL,
          onLabelChange: (label: TaskEdgeLabel) => {
            stableOnLabelChange(edge.id, label);
          },
        },
      })),
    );
  }, [canvas, documents, setNodes, setEdges, stableOnLabelChange]);

  useEffect(() => {
    bindFlowState(nodes, edges);
  }, [nodes, edges, bindFlowState]);

  useEffect(() => {
    registerTaskNodeCallbacks({
      onPatchLabel: (taskId, label) => {
        patchTask.mutate({ id: taskId, input: { label } });
        setNodes((current) =>
          current.map((node) =>
            node.id === taskId ? { ...node, data: { ...node.data, label } } : node,
          ),
        );
      },
      onPatchStatus: (taskId, status) => {
        patchTask.mutate({ id: taskId, input: { status } });
        setNodes((current) =>
          current.map((node) =>
            node.id === taskId ? { ...node, data: { ...node.data, status } } : node,
          ),
        );
      },
      onDelete: (taskId) => {
        deleteTask.mutate(
          { id: taskId, projectId },
          {
            onSuccess: () => {
              setSelectedNodeId(null);
            },
          },
        );
      },
    });
    return () => {
      registerTaskNodeCallbacks(null);
    };
  }, [patchTask, deleteTask, projectId, setNodes]);

  const handleEdgeLabelChange = useCallback(
    (edgeId: string, label: TaskEdgeLabel) => {
      setEdges((current) => {
        const next = current.map((edge) =>
          edge.id === edgeId ? { ...edge, data: { ...edge.data, label } } : edge,
        );
        saveWithState(nodes, next);
        return next;
      });
    },
    [setEdges, nodes, saveWithState],
  );

  handleEdgeLabelChangeRef.current = handleEdgeLabelChange;

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        const edgeId = crypto.randomUUID();
        const next = addEdge(
          {
            ...connection,
            id: edgeId,
            type: 'labeled',
            data: {
              label: DEFAULT_EDGE_LABEL,
              onLabelChange: (label: TaskEdgeLabel) => {
                stableOnLabelChange(edgeId, label);
              },
            },
          },
          current,
        );
        saveWithState(nodes, next);
        return next;
      });
    },
    [setEdges, nodes, saveWithState, stableOnLabelChange],
  );

  const handleNodeDragStop = useCallback(() => {
    onNodeDragStop();
  }, [onNodeDragStop]);

  const handleAutoArrange = useCallback(() => {
    setNodes((current) => {
      const arranged = layoutNodes(current, edges);
      saveWithState(arranged, edges);
      return arranged;
    });
  }, [setNodes, edges, saveWithState]);

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const nodeId = params.nodes[0]?.id ?? null;
    setSelectedNodeId(nodeId);
    setSelectedEdgeIds(params.edges.map((edge) => edge.id));
  }, []);

  const removeEdgeLocally = useCallback(
    (edgeId: string) => {
      setEdges((current) => {
        const next = current.filter((edge) => edge.id !== edgeId);
        saveWithState(nodes, next);
        return next;
      });
    },
    [setEdges, nodes, saveWithState],
  );

  const handleDeleteSelectedEdges = useCallback(() => {
    if (selectedEdgeIds.length === 0) {
      return;
    }
    if (!confirm(`Delete ${String(selectedEdgeIds.length)} selected edge(s)?`)) {
      return;
    }
    for (const edgeId of selectedEdgeIds) {
      if (UUID_RE.test(edgeId)) {
        deleteEdge.mutate(edgeId, {
          onSuccess: () => {
            removeEdgeLocally(edgeId);
          },
        });
      } else {
        removeEdgeLocally(edgeId);
      }
    }
    setSelectedEdgeIds([]);
  }, [selectedEdgeIds, deleteEdge, removeEdgeLocally]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT'
        ) {
          return;
        }
        if (selectedEdgeIds.length > 0) {
          event.preventDefault();
          handleDeleteSelectedEdges();
          return;
        }
        if (selectedNodeId !== null) {
          event.preventDefault();
          if (confirm('Delete this task? Connected edges will be removed.')) {
            deleteTask.mutate(
              { id: selectedNodeId, projectId },
              {
                onSuccess: () => {
                  setSelectedNodeId(null);
                },
              },
            );
          }
        }
      }
    },
    [selectedEdgeIds, handleDeleteSelectedEdges, selectedNodeId, deleteTask, projectId],
  );

  const selectedNode =
    selectedNodeId !== null ? nodes.find((n) => n.id === selectedNodeId) : undefined;

  if (isLoading) {
    return <p>Loading canvas…</p>;
  }

  if (error !== null) {
    return <p role="alert">Failed to load canvas: {error.message}</p>;
  }

  if (canvas === undefined) {
    return <p>Canvas not found.</p>;
  }

  const taskNodes = nodes.filter((n) => n.type === 'taskCard');
  const selectedTask =
    selectedNodeId !== null ? canvas.nodes.find((n) => n.id === selectedNodeId) : undefined;

  return (
    <div
      className="relative h-full min-w-0 flex-1 focus:outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {taskNodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            No tasks yet — add one in the box above to start your plan.
          </p>
        </div>
      ) : null}
      {isSaving ? (
        <span className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
          Saving…
        </span>
      ) : null}
      {saveError !== null ? (
        <p
          role="alert"
          className="pointer-events-none absolute left-1/2 top-10 z-20 -translate-x-1/2 rounded-full border border-destructive/40 bg-card px-2.5 py-1 text-[11px] text-destructive shadow-sm"
        >
          Save failed: {saveError.message}
        </p>
      ) : null}
      {selectedEdgeIds.length > 0 ? (
        <Panel position="top-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/40 bg-card text-destructive hover:bg-destructive/10"
            onClick={handleDeleteSelectedEdges}
          >
            <Trash2 /> Delete edge
          </Button>
        </Panel>
      ) : null}
      {selectedNode !== undefined ? (
        <TaskDetail
          taskId={selectedNode.id}
          data={selectedNode.data}
          isSaving={patchTask.isPending}
          tags={selectedTask?.tags ?? []}
          tagSuggestions={allTags?.map((t) => t.name) ?? []}
          onAddTag={(name) => {
            if (selectedTask === undefined) {
              return;
            }
            const names = (selectedTask.tags ?? []).map((t) => t.name);
            if (names.includes(name)) {
              return;
            }
            patchTask.mutate({ id: selectedTask.id, input: { tags: [...names, name] } });
          }}
          onRemoveTag={(name) => {
            if (selectedTask === undefined) {
              return;
            }
            const names = (selectedTask.tags ?? []).map((t) => t.name).filter((n) => n !== name);
            patchTask.mutate({ id: selectedTask.id, input: { tags: names } });
          }}
          onPatch={(input) => {
            patchTask.mutate({ id: selectedNode.id, input });
          }}
          onClose={() => {
            setSelectedNodeId(null);
          }}
          onDelete={() => {
            deleteTask.mutate(
              { id: selectedNode.id, projectId },
              {
                onSuccess: () => {
                  setSelectedNodeId(null);
                },
              },
            );
          }}
        />
      ) : null}
      <div className="h-full w-full bg-[var(--canvas)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onNodeDragStop={handleNodeDragStop}
          onSelectionChange={handleSelectionChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="var(--border-strong)"
          />
          <AddTaskPanel projectId={projectId} />
          <ArrangePanel onArrange={handleAutoArrange} />
          <ZoomControls />
        </ReactFlow>
      </div>
    </div>
  );
}
