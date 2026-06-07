import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { SerializedDocumentTree, SerializedEdge, SerializedTask } from '../../lib/api.js';
import {
  buildLayoutPayload,
  buildTaskDocumentMap,
  canvasToFlowEdges,
  canvasToFlowNodes,
  type LabeledEdgeData,
  type TaskNodeData,
} from './canvas-map.js';

const sampleTask: SerializedTask = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  project_id: 'proj-1',
  label: 'Design API',
  status: 'in_progress',
  description: 'Detailed spec',
  x: 120,
  y: 240,
  assignee: null,
  due_date: null,
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

const sampleEdge: SerializedEdge = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  project_id: 'proj-1',
  from_task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  to_task_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  label: 'blocks',
  arrow_direction: null,
  style: null,
  created_at: '2026-06-07T00:00:00.000Z',
};

describe('canvas-map', () => {
  it('maps API tasks to xyflow nodes', () => {
    const nodes = canvasToFlowNodes([sampleTask]);
    expect(nodes).toEqual([
      {
        id: sampleTask.id,
        type: 'taskCard',
        position: { x: 120, y: 240 },
        data: { label: 'Design API', status: 'in_progress', projectId: 'proj-1' },
      },
    ]);
  });

  it('maps API edges to xyflow edges with snake_case endpoints', () => {
    const edges = canvasToFlowEdges([sampleEdge]);
    expect(edges).toEqual([
      {
        id: sampleEdge.id,
        type: 'labeled',
        source: sampleEdge.from_task_id,
        target: sampleEdge.to_task_id,
        data: { label: 'blocks' },
      },
    ]);
  });

  it('maps linked documents onto task nodes', () => {
    const docTree: SerializedDocumentTree[] = [
      {
        id: 'doc-1',
        project_id: 'proj-1',
        title: 'Spec',
        body: null,
        status_line: null,
        parent_id: null,
        linked_task_id: sampleTask.id,
        created_at: '2026-06-07T00:00:00.000Z',
        updated_at: '2026-06-07T00:00:00.000Z',
        children: [],
      },
    ];
    const map = buildTaskDocumentMap(docTree);
    const nodes = canvasToFlowNodes([sampleTask], { taskDocumentMap: map });
    expect(nodes[0]?.data.documentId).toBe('doc-1');
  });

  it('buildLayoutPayload sends only x/y for nodes and omits semantic fields', () => {
    const nodes: Node<TaskNodeData>[] = [
      {
        id: sampleTask.id,
        type: 'taskCard',
        position: { x: 300, y: 400 },
        data: { label: 'Design API', status: 'in_progress', projectId: 'proj-1' },
      },
    ];
    const edges: Edge<LabeledEdgeData>[] = [
      {
        id: sampleEdge.id,
        type: 'labeled',
        source: sampleEdge.from_task_id,
        target: sampleEdge.to_task_id,
        data: { label: 'blocks' },
      },
      {
        id: 'reactflow__edge-a-b',
        type: 'labeled',
        source: sampleEdge.from_task_id,
        target: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        data: { label: 'depends_on' },
      },
    ];

    const payload = buildLayoutPayload(nodes, edges);

    expect(payload.nodes).toEqual([{ id: sampleTask.id, x: 300, y: 400 }]);
    expect(payload.edges).toEqual([
      {
        id: sampleEdge.id,
        from_task_id: sampleEdge.from_task_id,
        to_task_id: sampleEdge.to_task_id,
        label: 'blocks',
      },
      {
        from_task_id: sampleEdge.from_task_id,
        to_task_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        label: 'depends_on',
      },
    ]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('status');
    expect(serialized).not.toContain('description');
    expect(serialized).not.toMatch(/"label"\s*:\s*"Design API"/);
  });
});
