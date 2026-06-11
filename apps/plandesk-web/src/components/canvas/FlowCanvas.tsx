import { useCallback, useEffect, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import {
  Background,
  Controls,
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
import { DEFAULT_EDGE_LABEL } from '../../lib/api.js';
import {
  useCanvas,
  useCreateTask,
  useDeleteEdge,
  useDeleteTask,
  useDocuments,
  usePatchTask,
} from '../../lib/queries.js';
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
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '0.375rem',
          background: '#fff',
          padding: '0.5rem',
          borderRadius: 6,
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        <input
          type="text"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          placeholder="New task name"
          aria-label="New task name"
          style={{
            width: 160,
            padding: '0.375rem 0.5rem',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            fontSize: '0.875rem',
          }}
        />
        <button
          type="submit"
          disabled={createTask.isPending || label.trim() === ''}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: 4,
            border: '1px solid #1d4ed8',
            background: '#1d4ed8',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: createTask.isPending ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {createTask.isPending ? 'Adding…' : '+ Add task'}
        </button>
      </form>
    </Panel>
  );
}

function ArrangePanel({ onArrange }: { onArrange: () => void }) {
  const { fitView } = useReactFlow();

  return (
    <Panel position="top-right">
      <button
        type="button"
        onClick={() => {
          onArrange();
          void fitView({ padding: 0.2, duration: 300 });
        }}
        style={{
          padding: '0.375rem 0.75rem',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          background: '#fff',
          fontWeight: 600,
          fontSize: '0.875rem',
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        Auto-arrange
      </button>
    </Panel>
  );
}

export function FlowCanvas({ projectId }: FlowCanvasProps) {
  const { data: canvas, isLoading, error } = useCanvas(projectId);
  const { data: documents } = useDocuments(projectId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<LabeledEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const { bindFlowState, onNodeDragStop, saveWithState, isSaving, saveError } =
    useCanvasSync(projectId);
  const patchTask = usePatchTask();
  const deleteTask = useDeleteTask();
  const deleteEdge = useDeleteEdge(projectId);

  useEffect(() => {
    if (canvas === undefined) {
      return;
    }
    const taskDocumentMap = documents !== undefined ? buildTaskDocumentMap(documents) : undefined;
    setNodes(canvasToFlowNodes(canvas.nodes, { taskDocumentMap }));
    setEdges(canvasToFlowEdges(canvas.edges));
  }, [canvas, documents, setNodes, setEdges]);

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

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        const next = addEdge(
          {
            ...connection,
            type: 'labeled',
            data: { label: DEFAULT_EDGE_LABEL },
          },
          current,
        );
        saveWithState(nodes, next);
        return next;
      });
    },
    [setEdges, nodes, saveWithState],
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
        }
      }
    },
    [selectedEdgeIds, handleDeleteSelectedEdges],
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

  return (
    <div style={{ position: 'relative' }} onKeyDown={handleKeyDown} tabIndex={0}>
      {isSaving ? (
        <span
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            fontSize: '0.75rem',
            color: '#6b7280',
            background: '#fff',
            padding: '0.25rem 0.5rem',
            borderRadius: 4,
            border: '1px solid #e5e7eb',
          }}
        >
          Saving…
        </span>
      ) : null}
      {saveError !== null ? (
        <p role="alert" style={{ color: '#b91c1c', marginBottom: '0.5rem' }}>
          Save failed: {saveError.message}
        </p>
      ) : null}
      {selectedEdgeIds.length > 0 ? (
        <Panel position="top-center">
          <button
            type="button"
            onClick={handleDeleteSelectedEdges}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #fca5a5',
              background: '#fef2f2',
              color: '#b91c1c',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Delete edge
          </button>
        </Panel>
      ) : null}
      {selectedNode !== undefined ? (
        <TaskDetail
          taskId={selectedNode.id}
          data={selectedNode.data}
          isSaving={patchTask.isPending}
          onPatch={(input) => {
            patchTask.mutate({ id: selectedNode.id, input });
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
      <div style={{ width: '100%', height: 'calc(100vh - 12rem)', border: '1px solid #e5e7eb' }}>
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
          <Background />
          <Controls />
          <AddTaskPanel projectId={projectId} />
          <ArrangePanel onArrange={handleAutoArrange} />
        </ReactFlow>
      </div>
    </div>
  );
}
