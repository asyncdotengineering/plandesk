import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { LabeledEdgeData, TaskNodeData } from './canvas-map.js';

// Fallbacks for nodes that haven't been measured yet (node.measured is set
// by React Flow after first render).
const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 120;

export function layoutNodes(
  nodes: Node<TaskNodeData>[],
  edges: Edge<LabeledEdgeData>[],
): Node<TaskNodeData>[] {
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>().setDefaultEdgeLabel(
    () => ({}),
  );
  graph.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
      height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
    });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    // dagre types x/y as optional; a node it never laid out keeps its own position.
    if (positioned.x === undefined || positioned.y === undefined) {
      return node;
    }
    const width = node.measured?.width ?? DEFAULT_NODE_WIDTH;
    const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT;
    // dagre anchors at the node center; React Flow anchors at the top left.
    return {
      ...node,
      position: { x: positioned.x - width / 2, y: positioned.y - height / 2 },
    };
  });
}
