import {
  createArtifact as dbCreateArtifact,
  createEdge,
  getArtifact as dbGetArtifact,
  getLatestRevisionId,
  getPrototypeByProjectAndId,
  listArtifactsByProject as dbListArtifactsByProject,
  updateArtifact as dbUpdateArtifact,
  withTransaction,
  type Artifact,
  type ArtifactKind,
  type Db,
} from '@plandesk/db';
import {
  serializeArtifact,
  serializeArtifactSummary,
  type SerializedArtifact,
  type SerializedArtifactSummary,
} from '../serialize.js';
import { serializeActor } from '../write-actor.js';
import { assertPermission, resolveOrgId, resolveWriteActor, type OrgScopedDeps } from './org-scope.js';
import { findFlowDocumentForPrototype } from './prototypes.js';
import {
  ARTIFACT_VERSIONED_FIELDS,
  captureRevision,
  changedVersionedFields,
  versionedFieldSnapshot,
} from './revision-capture.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
import {
  applyScreenContentScan,
  assertScreenContentAllowed,
  clearScreenLinks,
  ExternalReferenceError,
  reResolveNullTargets,
  UnknownLibraryError,
} from './screen-scan.js';

export { ExternalReferenceError, UnknownLibraryError };

export type ArtifactServiceDeps = OrgScopedDeps & {
  db: Db;
  maxRevisions?: number | null;
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

async function resolveRevisionId(db: Db, artifact: Artifact): Promise<string> {
  const latest = await getLatestRevisionId(db, artifact.projectId, 'artifact', artifact.id);
  // Inferred: until the first versioned write, key remounts on updated_at.
  return latest ?? artifact.updatedAt.toISOString();
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

      // Refuse before insert so a rejected screen never lands in storage.
      if (typeof prototypeId === 'string') {
        assertScreenContentAllowed(input.content ?? '');
      }

      const artifact = await withTransaction(db, async (tx) => {
        const created = await dbCreateArtifact(tx, {
          projectId,
          title: input.title,
          kind,
          content: input.content,
          ...(prototypeId !== undefined ? { prototypeId } : {}),
        });

        if (typeof prototypeId === 'string') {
          await applyScreenContentScan(tx, {
            projectId,
            artifactId: created.id,
            prototypeId,
            content: created.content,
          });
          const flowDoc = await findFlowDocumentForPrototype(tx, projectId, prototypeId);
          if (flowDoc) {
            await createEdge(tx, {
              projectId,
              fromType: 'artifact',
              fromId: created.id,
              toType: 'document',
              toId: flowDoc.id,
              label: 'documents',
            });
          }
        }

        return created;
      });

      return serializeArtifact(artifact, await resolveRevisionId(db, artifact));
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
      return serializeArtifact(artifact, await resolveRevisionId(db, artifact));
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

      const nextContent = input.content !== undefined ? input.content : existing.content;

      // Refuse before write when the post-update artifact is a screen.
      if (nextPrototypeId !== null) {
        assertScreenContentAllowed(nextContent);
      }

      const versionedInput: Record<string, unknown> = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
      };
      const versionedChanges = changedVersionedFields(
        existing,
        versionedInput,
        ARTIFACT_VERSIONED_FIELDS,
      );

      const artifact = await withTransaction(db, async (tx) => {
        const updated = await dbUpdateArtifact(tx, id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.prototypeId !== undefined ? { prototypeId: input.prototypeId } : {}),
        });
        if (!updated) {
          return undefined;
        }

        if (versionedChanges.length > 0) {
          const author = serializeActor(resolveWriteActor(deps));
          await captureRevision(
            tx,
            {
              projectId: existing.projectId,
              targetType: 'artifact',
              targetId: id,
              snapshot: JSON.stringify(versionedFieldSnapshot(existing, ARTIFACT_VERSIONED_FIELDS)),
              changedFields: JSON.stringify(versionedChanges),
              author,
            },
            deps.maxRevisions ?? null,
          );
        }

        if (updated.prototypeId) {
          await applyScreenContentScan(tx, {
            projectId: updated.projectId,
            artifactId: updated.id,
            prototypeId: updated.prototypeId,
            content: updated.content,
          });
          // Newly attached to a prototype: link to its flow document.
          if (existing.prototypeId !== updated.prototypeId) {
            const flowDoc = await findFlowDocumentForPrototype(
              tx,
              updated.projectId,
              updated.prototypeId,
            );
            if (flowDoc) {
              await createEdge(tx, {
                projectId: updated.projectId,
                fromType: 'artifact',
                fromId: updated.id,
                toType: 'document',
                toId: flowDoc.id,
                label: 'documents',
              });
            }
          }
        } else {
          if (existing.prototypeId !== null) {
            await clearScreenLinks(tx, updated.id);
          }
          // A title change on any artifact can resolve a previously-null title link.
          if (input.title !== undefined) {
            await reResolveNullTargets(tx, updated.projectId);
          }
        }

        return updated;
      });

      if (!artifact) {
        return undefined;
      }

      return serializeArtifact(artifact, await resolveRevisionId(db, artifact));
    },
  };
}

export type ArtifactService = ReturnType<typeof createArtifactService>;
