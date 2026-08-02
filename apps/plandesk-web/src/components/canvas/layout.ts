import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

// Fallbacks for nodes that haven't been measured yet (node.measured is set
// by React Flow after first render).
const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 120;
const GRID_GAP_X = 40;
const GRID_GAP_Y = 40;

function widthOf(node: {
  width?: number | null;
  style?: { width?: string | number };
  measured?: { width?: number };
}): number {
  if (typeof node.width === 'number' && Number.isFinite(node.width)) {
    return node.width;
  }
  const styleWidth = node.style?.width;
  if (typeof styleWidth === 'number' && Number.isFinite(styleWidth)) {
    return styleWidth;
  }
  if (typeof styleWidth === 'string') {
    const parsed = Number.parseFloat(styleWidth);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return node.measured?.width ?? DEFAULT_NODE_WIDTH;
}

function heightOf(node: {
  height?: number | null;
  style?: { height?: string | number };
  measured?: { height?: number };
}): number {
  if (typeof node.height === 'number' && Number.isFinite(node.height)) {
    return node.height;
  }
  const styleHeight = node.style?.height;
  if (typeof styleHeight === 'number' && Number.isFinite(styleHeight)) {
    return styleHeight;
  }
  if (typeof styleHeight === 'string') {
    const parsed = Number.parseFloat(styleHeight);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return node.measured?.height ?? DEFAULT_NODE_HEIGHT;
}

export function layoutNodes<
  NodeData extends Record<string, unknown> = Record<string, unknown>,
  EdgeData extends Record<string, unknown> = Record<string, unknown>,
>(nodes: Node<NodeData>[], edges: Edge<EdgeData>[]): Node<NodeData>[] {
  // Split by connectivity: dagre ranks the dependency graph, but edgeless nodes
  // have no rank, so dagre lines them all up in one long horizontal strip that
  // conveys no structure and is hard to scan. Lay the connected graph out with
  // dagre, then pack the isolated nodes into a compact square-ish grid beneath it.
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  const connected = nodes.filter((node) => connectedIds.has(node.id));
  const isolated = nodes.filter((node) => !connectedIds.has(node.id));

  const positions = new Map<string, { x: number; y: number }>();

  let connectedMinX = 0;
  let connectedBottomY = 0;
  if (connected.length > 0) {
    const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>().setDefaultEdgeLabel(
      () => ({}),
    );
    graph.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });
    for (const node of connected) {
      graph.setNode(node.id, { width: widthOf(node), height: heightOf(node) });
    }
    for (const edge of edges) {
      graph.setEdge(edge.source, edge.target);
    }
    dagre.layout(graph);

    let minX = Infinity;
    let maxY = -Infinity;
    for (const node of connected) {
      const positioned = graph.node(node.id);
      if (positioned.x === undefined || positioned.y === undefined) {
        continue;
      }
      // dagre anchors at the node center; React Flow anchors at the top left.
      const x = positioned.x - widthOf(node) / 2;
      const y = positioned.y - heightOf(node) / 2;
      positions.set(node.id, { x, y });
      minX = Math.min(minX, x);
      maxY = Math.max(maxY, y + heightOf(node));
    }
    connectedMinX = Number.isFinite(minX) ? minX : 0;
    connectedBottomY = Number.isFinite(maxY) ? maxY : 0;
  }

  if (isolated.length > 0) {
    const cellWidth = Math.max(...isolated.map(widthOf)) + GRID_GAP_X;
    const cellHeight = Math.max(...isolated.map(heightOf)) + GRID_GAP_Y;
    // A square-ish grid reads far better than one long row.
    const columns = Math.max(1, Math.ceil(Math.sqrt(isolated.length)));
    const startX = connected.length > 0 ? connectedMinX : 0;
    const startY = connected.length > 0 ? connectedBottomY + GRID_GAP_Y * 2 : 0;
    isolated.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      positions.set(node.id, {
        x: startX + column * cellWidth,
        y: startY + row * cellHeight,
      });
    });
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    // A node that was somehow never positioned keeps its own position.
    return position === undefined ? node : { ...node, position };
  });
}
