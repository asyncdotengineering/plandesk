import {
  createPrototype as dbCreatePrototype,
  getPrototype as dbGetPrototype,
  listArtifactsByPrototype as dbListArtifactsByPrototype,
  listPrototypes as dbListPrototypes,
  updatePrototype as dbUpdatePrototype,
  type Db,
} from '@plandesk/db';
import {
  serializeArtifact,
  serializePrototype,
  type SerializedPrototype,
  type SerializedPrototypeWithScreens,
} from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
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

      const prototype = await dbCreatePrototype(db, {
        projectId,
        name: input.name,
        viewportWidth: input.viewportWidth,
        viewportHeight: input.viewportHeight,
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
      return { ...serializePrototype(prototype), screens };
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

      const prototype = await dbUpdatePrototype(db, id, input);
      if (!prototype) {
        return undefined;
      }

      return serializePrototype(prototype);
    },
  };
}

export type PrototypeService = ReturnType<typeof createPrototypeService>;
