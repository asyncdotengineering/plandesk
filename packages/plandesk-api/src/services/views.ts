import {
  createView as dbCreateView,
  deleteView as dbDeleteView,
  getView as dbGetView,
  listViews as dbListViews,
  updateView as dbUpdateView,
  InvalidSavedViewConfigError,
  parseSavedViewConfig,
  type Db,
  type SavedViewConfig,
} from '@plandesk/db';
import { serializeView, type SerializedView } from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type ViewServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreateViewInput = {
  name: string;
  config: unknown;
  position?: number;
};

export type UpdateViewInput = {
  name?: string;
  config?: unknown;
  position?: number;
};

export class InvalidViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidViewError';
  }
}

function normalizeViewName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new InvalidViewError('View name must not be empty');
  }
  return trimmed;
}

function parseConfigOrThrow(raw: unknown): SavedViewConfig {
  try {
    return parseSavedViewConfig(raw);
  } catch (error) {
    if (error instanceof InvalidSavedViewConfigError) {
      throw new InvalidViewError(error.message);
    }
    throw error;
  }
}

export function createViewService(deps: ViewServiceDeps) {
  const { db } = deps;

  return {
    async list(projectId: string): Promise<SerializedView[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListViews(db, projectId)).map(serializeView);
    },

    async get(id: string): Promise<SerializedView | undefined> {
      const existing = await dbGetView(db, id);
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
      return serializeView(existing);
    },

    async create(projectId: string, input: CreateViewInput): Promise<SerializedView | undefined> {
      assertPermission(deps, 'task', 'update');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const name = normalizeViewName(input.name);
      const config = parseConfigOrThrow(input.config);
      const view = await dbCreateView(db, {
        projectId,
        name,
        config,
        position: input.position,
      });
      return serializeView(view);
    },

    async update(id: string, input: UpdateViewInput): Promise<SerializedView | undefined> {
      assertPermission(deps, 'task', 'update');
      const existing = await dbGetView(db, id);
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

      let name: string | undefined;
      if (input.name !== undefined) {
        name = normalizeViewName(input.name);
      }
      let config: SavedViewConfig | undefined;
      if (input.config !== undefined) {
        config = parseConfigOrThrow(input.config);
      }

      const view = await dbUpdateView(db, id, {
        ...(name !== undefined ? { name } : {}),
        ...(config !== undefined ? { config } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      });
      if (!view) {
        return undefined;
      }
      return serializeView(view);
    },

    async delete(id: string): Promise<boolean> {
      assertPermission(deps, 'task', 'delete');
      const existing = await dbGetView(db, id);
      if (!existing) {
        return false;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }
      return dbDeleteView(db, id);
    },
  };
}

export type ViewService = ReturnType<typeof createViewService>;
