import {
  createTag as dbCreateTag,
  deleteTag as dbDeleteTag,
  getProject,
  getTag as dbGetTag,
  getTagByName,
  listTags as dbListTags,
  updateTag as dbUpdateTag,
  type Db,
} from '@plandesk/db';
import { serializeTag, type SerializedTag } from '../serialize.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type TagServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreateTagInput = {
  name: string;
  color?: string | null;
};

export type UpdateTagInput = {
  name?: string;
  color?: string | null;
};

export class InvalidTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTagError';
  }
}

export function normalizeTagName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new InvalidTagError('Tag name must not be empty');
  }
  return trimmed;
}

export function createTagService(deps: TagServiceDeps) {
  const { db } = deps;

  return {
    async list(projectId: string): Promise<SerializedTag[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListTags(db, projectId)).map(serializeTag);
    },

    async create(projectId: string, input: CreateTagInput): Promise<SerializedTag | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const name = normalizeTagName(input.name);
      if (await getTagByName(db, projectId, name)) {
        throw new InvalidTagError(`Tag already exists: ${name}`);
      }

      const tag = await dbCreateTag(db, { projectId, name, color: input.color });
      return serializeTag(tag);
    },

    // Renaming propagates everywhere automatically: tasks reference the single
    // tag row through the join table.
    async update(id: string, input: UpdateTagInput): Promise<SerializedTag | undefined> {
      const existing = await dbGetTag(db, id);
      if (!existing) {
        return undefined;
      }

      let name: string | undefined;
      if (input.name !== undefined) {
        name = normalizeTagName(input.name);
        const conflict = await getTagByName(db, existing.projectId, name);
        if (conflict && conflict.id !== id) {
          throw new InvalidTagError(`Tag already exists: ${name}`);
        }
      }

      const tag = await dbUpdateTag(db, id, {
        ...(name !== undefined ? { name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      });
      if (!tag) {
        return undefined;
      }

      return serializeTag(tag);
    },

    // Deleting a tag removes it from all its tasks (cascade on the join table).
    async delete(id: string): Promise<boolean> {
      const existing = await dbGetTag(db, id);
      if (!existing) {
        return false;
      }

      const deleted = await dbDeleteTag(db, id);
      if (!deleted) {
        return false;
      }

      return true;
    },
  };
}

export type TagService = ReturnType<typeof createTagService>;
