import {
  createArtifact as dbCreateArtifact,
  getArtifact as dbGetArtifact,
  getPrototypeByProjectAndId,
  listArtifactsByProject as dbListArtifactsByProject,
  updateArtifact as dbUpdateArtifact,
  type ArtifactKind,
  type Db,
} from '@plandesk/db';
import {
  serializeArtifact,
  serializeArtifactSummary,
  type SerializedArtifact,
  type SerializedArtifactSummary,
} from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type ArtifactServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreateArtifactInput = {
  title: string;
  kind?: ArtifactKind;
  content?: string;
  /** Optional prototype parent. Must belong to the same project; kind must be html. */
  prototypeId?: string | null;
};

export type UpdateArtifactInput = {
  title?: string;
  kind?: ArtifactKind;
  content?: string;
  prototypeId?: string | null;
};

export class InvalidArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArtifactError';
  }
}

function assertNonEmptyTitle(title: string): void {
  if (title.trim() === '') {
    throw new InvalidArtifactError('Artifact title must not be empty');
  }
}

/**
 * Enforce: prototypeId set ⇒ kind must be 'html', and the prototype must belong
 * to the same project. Cross-project ids are refused (never silently cleared).
 */
async function resolvePrototypeForWrite(
  db: Db,
  projectId: string,
  prototypeId: string | null | undefined,
  kind: ArtifactKind,
): Promise<string | null | undefined> {
  if (prototypeId === undefined) {
    return undefined;
  }
  if (prototypeId === null) {
    return null;
  }
  const prototype = await getPrototypeByProjectAndId(db, projectId, prototypeId);
  if (!prototype) {
    throw new InvalidArtifactError(
      'prototype_id does not belong to this project (unknown or cross-project)',
    );
  }
  if (kind !== 'html') {
    throw new InvalidArtifactError("prototype_id requires kind 'html'");
  }
  return prototypeId;
}

export function createArtifactService(deps: ArtifactServiceDeps) {
  const { db } = deps;

  return {
    async listByProject(projectId: string): Promise<SerializedArtifactSummary[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListArtifactsByProject(db, projectId)).map(serializeArtifactSummary);
    },

    async create(
      projectId: string,
      input: CreateArtifactInput,
    ): Promise<SerializedArtifact | undefined> {
      assertPermission(deps, 'document', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      assertNonEmptyTitle(input.title);
      const kind = input.kind ?? 'markdown';
      const prototypeId = await resolvePrototypeForWrite(db, projectId, input.prototypeId, kind);

      const artifact = await dbCreateArtifact(db, {
        projectId,
        title: input.title,
        kind,
        content: input.content,
        ...(prototypeId !== undefined ? { prototypeId } : {}),
      });

      return serializeArtifact(artifact);
    },

    async get(id: string): Promise<SerializedArtifact | undefined> {
      const artifact = await dbGetArtifact(db, id);
      if (!artifact) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, artifact.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return serializeArtifact(artifact);
    },

    async update(id: string, input: UpdateArtifactInput): Promise<SerializedArtifact | undefined> {
      assertPermission(deps, 'document', 'update');
      const existing = await dbGetArtifact(db, id);
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

      if (input.title !== undefined) {
        assertNonEmptyTitle(input.title);
      }

      const nextKind = input.kind ?? existing.kind;
      const nextPrototypeId =
        input.prototypeId !== undefined ? input.prototypeId : existing.prototypeId;

      // Validate the post-update pair even when only one field is being changed.
      if (nextPrototypeId !== null) {
        await resolvePrototypeForWrite(db, existing.projectId, nextPrototypeId, nextKind);
      } else if (input.prototypeId === null) {
        // clearing is fine for any kind
      }

      const artifact = await dbUpdateArtifact(db, id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.prototypeId !== undefined ? { prototypeId: input.prototypeId } : {}),
      });
      if (!artifact) {
        return undefined;
      }

      return serializeArtifact(artifact);
    },
  };
}

export type ArtifactService = ReturnType<typeof createArtifactService>;
