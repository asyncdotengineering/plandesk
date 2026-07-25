import type { Edge, Node } from '@xyflow/react';
import type {
  EdgeLabel,
  PutCanvasInput,
  SerializedDocumentTree,
  SerializedEdge,
  SerializedTask,
  TaskStatus,
} from '../../lib/api.js';

export type TaskNodeData = {
  label: string;
  status: TaskStatus;
  projectId: string;
  documentId?: string;
  description: string | null;
  assignee: string | null;
  dueDate: string | null;
};

export type LabeledEdgeData = {
  label: string;
  onLabelChange?: (label: EdgeLabel) => void;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * First document linking to each task (for compact canvas node affordances).
 * Multi-doc lists live on the task detail drawer; Flow stays task-only.
 */
export function buildTaskDocumentMap(trees: SerializedDocumentTree[]): Map<string, string> {
  const map = new Map<string, string>();

  function walk(nodes: SerializedDocumentTree[]) {
    for (const node of nodes) {
      for (const link of node.links) {
        if (link.type === 'task' && !map.has(link.id)) {
          map.set(link.id, node.id);
        }
      }
      walk(node.children);
    }
  }

  walk(trees);
  return map;
}

export function canvasToFlowNodes(
  tasks: SerializedTask[],
  options: { taskDocumentMap?: Map<string, string> } = {},
): Node<TaskNodeData>[] {
  return tasks.map((task) => ({
    id: task.id,
    type: 'taskCard',
    position: { x: task.x, y: task.y },
    data: {
      label: task.label,
      status: task.status,
      projectId: task.project_id,
      documentId: options.taskDocumentMap?.get(task.id),
      description: task.description,
      assignee: task.assignee,
      dueDate: task.due_date,
    },
  }));
}

export function canvasToFlowEdges(edges: SerializedEdge[]): Edge<LabeledEdgeData>[] {
  // Canvas payload is task-graph only; skip any edge missing task endpoints.
  return edges
    .filter((edge) => edge.from_task_id !== null && edge.to_task_id !== null)
    .map((edge) => ({
      id: edge.id,
      type: 'labeled',
      source: edge.from_task_id as string,
      target: edge.to_task_id as string,
      data: { label: edge.label ?? 'depends_on' },
    }));
}

export function buildLayoutPayload(
  nodes: Node<TaskNodeData>[],
  edges: Edge<LabeledEdgeData>[],
): PutCanvasInput {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
    })),
    edges: edges.map((edge) => {
      const payload: PutCanvasInput['edges'][number] = {
        from_task_id: edge.source,
        to_task_id: edge.target,
        label: edge.data?.label ?? 'depends_on',
      };
      if (UUID_RE.test(edge.id)) {
        payload.id = edge.id;
      }
      return payload;
    }),
  };
}
