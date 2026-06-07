import { useCallback, useEffect } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DEFAULT_EDGE_LABEL } from '../../lib/api.js';
import { useCanvas } from '../../lib/queries.js';
import {
  canvasToFlowEdges,
  canvasToFlowNodes,
  type LabeledEdgeData,
  type TaskNodeData,
} from './canvas-map.js';
import { LabeledEdge } from './LabeledEdge.js';
import { TaskNode } from './TaskNode.js';
import { useCanvasSync } from './useCanvasSync.js';

const nodeTypes = { taskCard: TaskNode };
const edgeTypes = { labeled: LabeledEdge };

type FlowCanvasProps = {
  projectId: string;
};

export function FlowCanvas({ projectId }: FlowCanvasProps) {
  const { data: canvas, isLoading, error } = useCanvas(projectId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<LabeledEdgeData>>([]);
  const { bindFlowState, onNodeDragStop, saveWithState, isSaving, saveError } =
    useCanvasSync(projectId);

  useEffect(() => {
    if (canvas === undefined) {
      return;
    }
    setNodes(canvasToFlowNodes(canvas.nodes));
    setEdges(canvasToFlowEdges(canvas.edges));
  }, [canvas, setNodes, setEdges]);

  useEffect(() => {
    bindFlowState(nodes, edges);
  }, [nodes, edges, bindFlowState]);

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
    <div style={{ position: 'relative' }}>
      {isSaving ? (
        <span
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
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
      <div style={{ width: '100%', height: 'calc(100vh - 12rem)', border: '1px solid #e5e7eb' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
