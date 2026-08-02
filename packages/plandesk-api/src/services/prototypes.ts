import {
  createDocument,
  createEdge,
  createFolder,
  createPrototype as dbCreatePrototype,
  getDocument,
  getPrototype as dbGetPrototype,
  listArtifactsByPrototype as dbListArtifactsByPrototype,
  listEdgesByEndpoint,
  listPrototypeLinksByProject,
  listPrototypes as dbListPrototypes,
  updateFolder,
  updatePrototype as dbUpdatePrototype,
  withTransaction,
  type Db,
  type Document,
} from '@plandesk/db';
import {
  serializeArtifact,
  serializePrototype,
  serializePrototypeLink,
  type SerializedPrototype,
  type SerializedPrototypeWithScreens,
} from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { flowDocumentTitle, seededFlowDocumentBody } from './prototype-flow.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type PrototypeServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreatePrototypeInput = {
  name: string;
  viewportWidth: number;
  viewportHeight: number;
};

export type UpdatePrototypeInput = {
  name?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

export class InvalidPrototypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPrototypeError';
  }
}

function assertNonEmptyName(name: string): void {
  if (name.trim() === '') {
    throw new InvalidPrototypeError('Prototype name must not be empty');
  }
}

function assertPositiveViewport(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new InvalidPrototypeError('Viewport width and height must be finite positive numbers');
  }
}

/** Resolve the flow document edged to a prototype (document → prototype). */
export async function findFlowDocumentForPrototype(
  db: Db,
  projectId: string,
  prototypeId: string,
): Promise<Document | undefined> {
  const edges = await listEdgesByEndpoint(db, projectId, 'prototype', prototypeId);
  const flowEdge = edges.find(
    (e) => e.fromType === 'document' && e.toType === 'prototype' && e.toId === prototypeId,
  );
  if (!flowEdge) {
    return undefined;
  }
  return getDocument(db, flowEdge.fromId);
}

export function createPrototypeService(deps: PrototypeServiceDeps) {
  const { db } = deps;

  return {
    async list(projectId: string): Promise<SerializedPrototype[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListPrototypes(db, projectId)).map(serializePrototype);
    },

    async create(
      projectId: string,
      input: CreatePrototypeInput,
    ): Promise<SerializedPrototype | undefined> {
      assertPermission(deps, 'document', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      assertNonEmptyName(input.name);
      assertPositiveViewport(input.viewportWidth, input.viewportHeight);

      const prototype = await withTransaction(db, async (tx) => {
        const folder = await createFolder(tx, {
          projectId,
          name: input.name,
        });

        const created = await dbCreatePrototype(tx, {
          projectId,
          name: input.name,
          viewportWidth: input.viewportWidth,
          viewportHeight: input.viewportHeight,
          folderId: folder.id,
        });

        const flowDoc = await createDocument(tx, {
          projectId,
          title: flowDocumentTitle(input.name),
          body: seededFlowDocumentBody(input.name),
          statusLine: 'Ready to implement',
          folderId: folder.id,
        });

        await createEdge(tx, {
          projectId,
          fromType: 'document',
          fromId: flowDoc.id,
          toType: 'prototype',
          toId: created.id,
          label: 'documents',
        });

        return created;
      });

      return serializePrototype(prototype);
    },

    async get(id: string): Promise<SerializedPrototypeWithScreens | undefined> {
      const prototype = await dbGetPrototype(db, id);
      if (!prototype) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, prototype.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      const screens = (await dbListArtifactsByPrototype(db, prototype.id)).map(serializeArtifact);
      const screenIds = new Set(screens.map((s) => s.id));
      const links = (await listPrototypeLinksByProject(db, prototype.projectId))
        .filter((link) => screenIds.has(link.fromArtifactId))
        .map(serializePrototypeLink);
      return { ...serializePrototype(prototype), screens, links };
    },

    async update(
      id: string,
      input: UpdatePrototypeInput,
    ): Promise<SerializedPrototype | undefined> {
      assertPermission(deps, 'document', 'update');
      const existing = await dbGetPrototype(db, id);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.name !== undefined) {
        assertNonEmptyName(input.name);
      }
      const nextWidth = input.viewportWidth ?? existing.viewportWidth;
      const nextHeight = input.viewportHeight ?? existing.viewportHeight;
      if (input.viewportWidth !== undefined || input.viewportHeight !== undefined) {
        assertPositiveViewport(nextWidth, nextHeight);
      }

      const prototype = await withTransaction(db, async (tx) => {
        const updated = await dbUpdatePrototype(tx, id, input);
        if (!updated) {
          return undefined;
        }

        if (input.name !== undefined && existing.folderId) {
          await updateFolder(tx, existing.folderId, { name: input.name });
        }

        return updated;
      });

      if (!prototype) {
        return undefined;
      }

      return serializePrototype(prototype);
    },
  };
}

export type PrototypeService = ReturnType<typeof createPrototypeService>;
