import {
  withTransaction,
  createEdge,
  createTask,
  getOrCreateDefaultGoal,
  deleteEdge as dbDeleteEdge,
  deleteEdgeByEndpoints,
  getDocument,
  getEdge,
  getEdgeByEndpoints,
  getEdgeByProjectAndId,
  getProject,
  getTask,
  linkEntityTypes,
  listEdges as dbListEdges,
  listEdgesByEndpoint,
  listTasks,
  updateEdge,
  updateProject,
  updateTask,
  type Db,
  type LinkEntityType,
  type Project,
} from '@plandesk/db';
import { serializeEdge, serializeTask } from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type CanvasServiceDeps = OrgScopedDeps & {
  db: Db;
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

/** Typed create input. Task-shaped callers map to type `task` via createEdge. */
export type CreateEdgeInput = {
  fromType?: LinkEntityType;
  fromId?: string;
  toType?: LinkEntityType;
  toId?: string;
  /** Legacy task-shaped fields — accepted and mapped to type `task`. */
  fromTaskId?: string;
  toTaskId?: string;
  label?: string | null;
  style?: string | null;
  arrowDirection?: string | null;
};

export type EdgeEndpointsInput = {
  fromType: LinkEntityType;
  fromId: string;
  toType: LinkEntityType;
  toId: string;
};

export class InvalidCanvasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCanvasError';
  }
}

const LINK_ENTITY_TYPE_SET = new Set<string>(linkEntityTypes);

function parseLayout(projectLayout: string | null): unknown {
  if (projectLayout === null) {
    return null;
  }
  return JSON.parse(projectLayout) as unknown;
}

function serializeLayout(projectLayout: string | null): unknown {
  return parseLayout(projectLayout);
}

function isTaskGraphEdge(edge: {
  fromType: LinkEntityType;
  toType: LinkEntityType;
}): boolean {
  return edge.fromType === 'task' && edge.toType === 'task';
}

function assertLinkEntityType(value: string, side: 'from' | 'to'): asserts value is LinkEntityType {
  if (!LINK_ENTITY_TYPE_SET.has(value)) {
    throw new InvalidCanvasError(`Unknown ${side} entity type: ${value}`);
  }
}

/**
 * Resolve one endpoint through its declared type's tenant-scoped accessor.
 * Never trust the caller's type claim without a hit in that table.
 */
async function resolveEndpointInProject(
  db: Db,
  projectId: string,
  type: LinkEntityType,
  id: string,
  side: 'from' | 'to',
): Promise<void> {
  if (type === 'task') {
    const task = await getTask(db, id);
    if (!task || task.projectId !== projectId) {
      throw new InvalidCanvasError(`Edge ${side} task not found in project`);
    }
    return;
  }
  const document = await getDocument(db, id);
  if (!document || document.projectId !== projectId) {
    throw new InvalidCanvasError(`Edge ${side} document not found in project`);
  }
}

/**
 * Resolve both endpoints, confirm each exists as the claimed type inside
 * projectId, and confirm they share that project (cross-project refused).
 */
async function assertEndpointsInProject(
  db: Db,
  projectId: string,
  endpoints: EdgeEndpointsInput,
): Promise<void> {
  assertLinkEntityType(endpoints.fromType, 'from');
  assertLinkEntityType(endpoints.toType, 'to');
  await resolveEndpointInProject(db, projectId, endpoints.fromType, endpoints.fromId, 'from');
  await resolveEndpointInProject(db, projectId, endpoints.toType, endpoints.toId, 'to');
}

function normalizeCreateInput(input: CreateEdgeInput): EdgeEndpointsInput {
  const fromType = input.fromType ?? (input.fromTaskId !== undefined ? 'task' : undefined);
  const toType = input.toType ?? (input.toTaskId !== undefined ? 'task' : undefined);
  const fromId = input.fromId ?? input.fromTaskId;
  const toId = input.toId ?? input.toTaskId;

  if (fromType === undefined || toType === undefined || fromId === undefined || toId === undefined) {
    throw new InvalidCanvasError('Edge requires from/to endpoints (typed or task-shaped)');
  }
  assertLinkEntityType(fromType, 'from');
  assertLinkEntityType(toType, 'to');
  return { fromType, fromId, toType, toId };
}

export function createCanvasService(deps: CanvasServiceDeps) {
  const { db } = deps;

  async function buildCanvas(projectId: string, project: Project) {
    const tasks = await listTasks(db, projectId);
    const edgeRows = (await dbListEdges(db, projectId)).filter(isTaskGraphEdge);

    return {
      nodes: tasks.map((task) => serializeTask(task)),
      edges: edgeRows.map(serializeEdge),
      layout: serializeLayout(project.canvasLayout),
    };
  }

  return {
    async get(projectId: string) {
      try {
        const project = await assertProjectInOrg(db, projectId, resolveOrgId(deps));
        return await buildCanvas(projectId, project);
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
    },

    /**
     * Create an edge by typed endpoints `(from_type, from_id, to_type, to_id)`.
     * Task-shaped `{ fromTaskId, toTaskId }` is still accepted and mapped to type `task`.
     */
    async createEdge(projectId: string, input: CreateEdgeInput) {
      assertPermission(deps, 'edge', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const endpoints = normalizeCreateInput(input);
      await assertEndpointsInProject(db, projectId, endpoints);

      const edge = await createEdge(db, {
        projectId,
        fromType: endpoints.fromType,
        fromId: endpoints.fromId,
        toType: endpoints.toType,
        toId: endpoints.toId,
        label: input.label ?? null,
        style: input.style ?? null,
        arrowDirection: input.arrowDirection ?? null,
      });

      return serializeEdge(edge);
    },

    async putLayout(projectId: string, payload: PutCanvasLayoutInput) {
      assertPermission(deps, 'task', 'update');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
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

        // Only reconcile the task graph. Polymorphic (document) edges are owned
        // by the typed link service and must survive a canvas layout put.
        const existingEdges = (await dbListEdges(tx, projectId)).filter(isTaskGraphEdge);
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
            fromType: 'task' as const,
            fromId: edgeInput.from_task_id,
            toType: 'task' as const,
            toId: edgeInput.to_task_id,
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

      return buildCanvas(projectId, updatedProject);
    },

    async deleteEdge(projectId: string, edgeId: string) {
      assertPermission(deps, 'edge', 'delete');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }
      const edge = await getEdgeByProjectAndId(db, projectId, edgeId);
      if (!edge) {
        return false;
      }

      await dbDeleteEdge(db, edgeId);
      return true;
    },

    /**
     * Delete by typed endpoints. Returns false when the edge is missing or the
     * project is outside the caller's scope (same 404 no-leak shape as by-id).
     */
    async deleteEdgeByEndpoints(projectId: string, endpoints: EdgeEndpointsInput) {
      assertPermission(deps, 'edge', 'delete');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      assertLinkEntityType(endpoints.fromType, 'from');
      assertLinkEntityType(endpoints.toType, 'to');

      // Refuse rather than delete when either endpoint is outside this project.
      // Existence of the edge row alone is not enough — endpoints must still resolve.
      try {
        await assertEndpointsInProject(db, projectId, endpoints);
      } catch (error) {
        if (error instanceof InvalidCanvasError) {
          return false;
        }
        throw error;
      }

      return deleteEdgeByEndpoints(db, projectId, endpoints);
    },

    async listEdges(projectId: string) {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListEdges(db, projectId)).map(serializeEdge);
    },

    /**
     * List edges involving a single typed endpoint (from or to side).
     * Validates the endpoint exists in the project before reading.
     */
    async listEdgesForEndpoint(
      projectId: string,
      type: LinkEntityType,
      id: string,
    ) {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      assertLinkEntityType(type, 'from');
      try {
        await resolveEndpointInProject(db, projectId, type, id, 'from');
      } catch (error) {
        if (error instanceof InvalidCanvasError) {
          return undefined;
        }
        throw error;
      }

      return (await listEdgesByEndpoint(db, projectId, type, id)).map(serializeEdge);
    },

    async getEdgeByEndpoints(projectId: string, endpoints: EdgeEndpointsInput) {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      assertLinkEntityType(endpoints.fromType, 'from');
      assertLinkEntityType(endpoints.toType, 'to');
      try {
        await assertEndpointsInProject(db, projectId, endpoints);
      } catch (error) {
        if (error instanceof InvalidCanvasError) {
          return undefined;
        }
        throw error;
      }

      const edge = await getEdgeByEndpoints(db, projectId, endpoints);
      return edge ? serializeEdge(edge) : undefined;
    },

    // For delete_edge(edge_id): resolves the owning project from the edge
    // itself, so the caller doesn't have to know project_id up front.
    async deleteEdgeById(edgeId: string): Promise<boolean> {
      assertPermission(deps, 'edge', 'delete');
      const edge = await getEdge(db, edgeId);
      if (!edge) {
        return false;
      }
      try {
        await assertProjectInOrg(db, edge.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      await dbDeleteEdge(db, edgeId);
      return true;
    },
  };
}

export type CanvasService = ReturnType<typeof createCanvasService>;
