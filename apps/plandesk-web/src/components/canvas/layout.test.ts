import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { LabeledEdgeData, TaskNodeData } from './canvas-map.js';
import { layoutNodes } from './layout.js';

function makeNode(id: string): Node<TaskNodeData> {
  return {
    id,
    type: 'taskCard',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      status: 'todo',
      projectId: 'proj-1',
      description: null,
      assignee: null,
      dueDate: null,
    },
  };
}

function makeEdge(source: string, target: string): Edge<LabeledEdgeData> {
  return { id: `${source}-${target}`, source, target, type: 'labeled', data: { label: 'blocks' } };
}

function positionOf(nodes: Node<TaskNodeData>[], id: string): { x: number; y: number } {
  const node = nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    throw new Error(`missing node ${id}`);
  }
  return node.position;
}

describe('layoutNodes', () => {
  it('ranks dependent nodes below their sources (top-to-bottom)', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];

    const layouted = layoutNodes(nodes, edges);

    expect(positionOf(layouted, 'a').y).toBeLessThan(positionOf(layouted, 'b').y);
    expect(positionOf(layouted, 'b').y).toBeLessThan(positionOf(layouted, 'c').y);
  });

  it('separates unconnected nodes so they do not overlap', () => {
    const layouted = layoutNodes([makeNode('a'), makeNode('b')], []);
    const a = positionOf(layouted, 'a');
    const b = positionOf(layouted, 'b');

    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it('preserves node identity and data', () => {
    const layouted = layoutNodes([makeNode('a')], []);
    expect(positionOf(layouted, 'a')).toBeDefined();
    expect(layouted.map((node) => node.data.label)).toEqual(['a']);
  });
});
