import {
  createEdge,
  createTask,
  deleteEdge as dbDeleteEdge,
  getEdgeByProjectAndId,
  getProject,
  getTask,
  listEdges,
  listTasks,
  updateEdge,
  updateProject,
  updateTask,
  type Db,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeEdge, serializeTask } from '../serialize.js';

export type CanvasServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CanvasNodeInput = {
  id?: string;
  x: number;
  y: number;
  label?: string;
  status?: string;
};

export type CanvasEdgeInput = {
  id?: string;
  from_task_id: string;
  to_task_id: string;
  label?: string | null;
  arrow_direction?: string | null;
  style?: string | null;
};

export type PutCanvasLayoutInput = {
  nodes: CanvasNodeInput[];
  edges: CanvasEdgeInput[];
  layout?: unknown;
};

export class InvalidCanvasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCanvasError';
  }
}

function parseLayout(projectLayout: string | null): unknown {
  if (projectLayout === null) {
    return null;
  }
  return JSON.parse(projectLayout) as unknown;
}

function serializeLayout(projectLayout: string | null): unknown {
  return parseLayout(projectLayout);
}

export function createCanvasService(deps: CanvasServiceDeps) {
  const { db, eventBus } = deps;

  function buildCanvas(projectId: string, project: NonNullable<ReturnType<typeof getProject>>) {
    const tasks = listTasks(db, projectId);
    const edgeRows = listEdges(db, projectId);

    return {
      nodes: tasks.map(serializeTask),
      edges: edgeRows.map(serializeEdge),
      layout: serializeLayout(project.canvasLayout),
    };
  }

  return {
    get(projectId: string) {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      return buildCanvas(projectId, project);
    },

    createEdge(
      projectId: string,
      input: { fromTaskId: string; toTaskId: string; label?: string | null; style?: string | null },
    ) {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const taskIds = new Set(listTasks(db, projectId).map((task) => task.id));
      if (!taskIds.has(input.fromTaskId)) {
        throw new InvalidCanvasError('Edge references missing from task');
      }
      if (!taskIds.has(input.toTaskId)) {
        throw new InvalidCanvasError('Edge references missing to task');
      }

      const edge = createEdge(db, {
        projectId,
        fromTaskId: input.fromTaskId,
        toTaskId: input.toTaskId,
        label: input.label ?? null,
        style: input.style ?? null,
      });

      eventBus.emit({ type: 'canvas_updated', projectId });

      return serializeEdge(edge);
    },

    putLayout(projectId: string, payload: PutCanvasLayoutInput) {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      for (const node of payload.nodes) {
        if (node.id !== undefined) {
          const existing = getTask(db, node.id);
          if (existing && existing.projectId !== projectId) {
            throw new InvalidCanvasError('Task does not belong to project');
          }
        }
      }

      const taskIds = new Set(listTasks(db, projectId).map((task) => task.id));

      for (const edge of payload.edges) {
        if (
          !taskIds.has(edge.from_task_id) &&
          !payload.nodes.some((n) => n.id === edge.from_task_id)
        ) {
          throw new InvalidCanvasError('Edge references missing from task');
        }
        if (!taskIds.has(edge.to_task_id) && !payload.nodes.some((n) => n.id === edge.to_task_id)) {
          throw new InvalidCanvasError('Edge references missing to task');
        }
      }

      db.transaction((tx) => {
        for (const node of payload.nodes) {
          if (node.id !== undefined) {
            const existing = getTask(tx, node.id);
            if (existing) {
              updateTask(tx, node.id, { x: node.x, y: node.y });
              continue;
            }
          }

          if (typeof node.label !== 'string' || node.label.trim() === '') {
            throw new InvalidCanvasError('New canvas node requires label');
          }

          const created = createTask(tx, {
            projectId,
            id: node.id,
            label: node.label,
            status: 'todo',
            x: node.x,
            y: node.y,
          });
          taskIds.add(created.id);
        }

        for (const edgeInput of payload.edges) {
          if (!taskIds.has(edgeInput.from_task_id)) {
            throw new InvalidCanvasError('Edge references missing from task');
          }
          if (!taskIds.has(edgeInput.to_task_id)) {
            throw new InvalidCanvasError('Edge references missing to task');
          }
        }

        const existingEdges = listEdges(tx, projectId);
        const payloadEdgeIds = new Set(
          payload.edges.map((edge) => edge.id).filter((id): id is string => id !== undefined),
        );

        for (const existingEdge of existingEdges) {
          if (!payloadEdgeIds.has(existingEdge.id)) {
            dbDeleteEdge(tx, existingEdge.id);
          }
        }

        for (const edgeInput of payload.edges) {
          const edgeData = {
            fromTaskId: edgeInput.from_task_id,
            toTaskId: edgeInput.to_task_id,
            label: edgeInput.label ?? null,
            arrowDirection: edgeInput.arrow_direction ?? null,
            style: edgeInput.style ?? null,
          };

          if (edgeInput.id !== undefined) {
            const existing = getEdgeByProjectAndId(tx, projectId, edgeInput.id);
            if (existing) {
              updateEdge(tx, edgeInput.id, edgeData);
              continue;
            }
            createEdge(tx, { projectId, id: edgeInput.id, ...edgeData });
            continue;
          }

          createEdge(tx, { projectId, ...edgeData });
        }

        const layoutJson =
          payload.layout === undefined ? undefined : JSON.stringify(payload.layout);
        updateProject(tx, projectId, {
          ...(layoutJson !== undefined ? { canvasLayout: layoutJson } : {}),
        });
      });

      const updatedProject = getProject(db, projectId);
      if (!updatedProject) {
        return undefined;
      }

      eventBus.emit({ type: 'canvas_updated', projectId });

      return buildCanvas(projectId, updatedProject);
    },

    deleteEdge(projectId: string, edgeId: string) {
      const edge = getEdgeByProjectAndId(db, projectId, edgeId);
      if (!edge) {
        return false;
      }

      dbDeleteEdge(db, edgeId);
      eventBus.emit({ type: 'canvas_updated', projectId });
      return true;
    },
  };
}

export type CanvasService = ReturnType<typeof createCanvasService>;
