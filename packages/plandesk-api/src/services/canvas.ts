import {
  withTransaction,
  createEdge,
  createTask,
  getOrCreateDefaultGoal,
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
  type Project,
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

  async function buildCanvas(projectId: string, project: Project) {
    const tasks = await listTasks(db, projectId);
    const edgeRows = await listEdges(db, projectId);

    return {
      nodes: tasks.map((task) => serializeTask(task)),
      edges: edgeRows.map(serializeEdge),
      layout: serializeLayout(project.canvasLayout),
    };
  }

  return {
    async get(projectId: string) {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      return buildCanvas(projectId, project);
    },

    async createEdge(
      projectId: string,
      input: { fromTaskId: string; toTaskId: string; label?: string | null; style?: string | null },
    ) {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const taskIds = new Set((await listTasks(db, projectId)).map((task) => task.id));
      if (!taskIds.has(input.fromTaskId)) {
        throw new InvalidCanvasError('Edge references missing from task');
      }
      if (!taskIds.has(input.toTaskId)) {
        throw new InvalidCanvasError('Edge references missing to task');
      }

      const edge = await createEdge(db, {
        projectId,
        fromTaskId: input.fromTaskId,
        toTaskId: input.toTaskId,
        label: input.label ?? null,
        style: input.style ?? null,
      });

      eventBus.emit({ type: 'canvas_updated', projectId });

      return serializeEdge(edge);
    },

    async putLayout(projectId: string, payload: PutCanvasLayoutInput) {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      for (const node of payload.nodes) {
        if (node.id !== undefined) {
          const existing = await getTask(db, node.id);
          if (existing && existing.projectId !== projectId) {
            throw new InvalidCanvasError('Task does not belong to project');
          }
        }
      }

      const taskIds = new Set((await listTasks(db, projectId)).map((task) => task.id));

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

      await withTransaction(db, async (tx) => {
        for (const node of payload.nodes) {
          if (node.id !== undefined) {
            const existing = await getTask(tx, node.id);
            if (existing) {
              await updateTask(tx, node.id, { x: node.x, y: node.y });
              continue;
            }
          }

          if (typeof node.label !== 'string' || node.label.trim() === '') {
            throw new InvalidCanvasError('New canvas node requires label');
          }

          const created = await createTask(tx, {
            projectId,
            goalId: (await getOrCreateDefaultGoal(tx, projectId)).id,
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

        const existingEdges = await listEdges(tx, projectId);
        const payloadEdgeIds = new Set(
          payload.edges.map((edge) => edge.id).filter((id): id is string => id !== undefined),
        );

        for (const existingEdge of existingEdges) {
          if (!payloadEdgeIds.has(existingEdge.id)) {
            await dbDeleteEdge(tx, existingEdge.id);
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
            const existing = await getEdgeByProjectAndId(tx, projectId, edgeInput.id);
            if (existing) {
              await updateEdge(tx, edgeInput.id, edgeData);
              continue;
            }
            await createEdge(tx, { projectId, id: edgeInput.id, ...edgeData });
            continue;
          }

          await createEdge(tx, { projectId, ...edgeData });
        }

        const layoutJson =
          payload.layout === undefined ? undefined : JSON.stringify(payload.layout);
        await updateProject(tx, projectId, {
          ...(layoutJson !== undefined ? { canvasLayout: layoutJson } : {}),
        });
      });

      const updatedProject = await getProject(db, projectId);
      if (!updatedProject) {
        return undefined;
      }

      eventBus.emit({ type: 'canvas_updated', projectId });

      return buildCanvas(projectId, updatedProject);
    },

    async deleteEdge(projectId: string, edgeId: string) {
      const edge = await getEdgeByProjectAndId(db, projectId, edgeId);
      if (!edge) {
        return false;
      }

      await dbDeleteEdge(db, edgeId);
      eventBus.emit({ type: 'canvas_updated', projectId });
      return true;
    },
  };
}

export type CanvasService = ReturnType<typeof createCanvasService>;
