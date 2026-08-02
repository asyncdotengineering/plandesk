import {
  createArtifact as dbCreateArtifact,
  createEdge,
  deleteEdgeByEndpoints,
  getArtifact as dbGetArtifact,
  getLatestRevisionId,
  getPrototypeByProjectAndId,
  listArtifactsByProject as dbListArtifactsByProject,
  listEdgesByEndpoint,
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
import {
  assertPermission,
  resolveOrgId,
  resolveWriteActor,
  type OrgScopedDeps,
} from './org-scope.js';
import { findFlowDocumentForPrototype } from './prototypes.js';
import { ensurePrototypeLayout } from './prototype-layout.js';
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
  x?: number | null;
  y?: number | null;
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
          // System-owned layout: agents never send coordinates.
          await ensurePrototypeLayout(tx, prototypeId);
          const laidOut = await dbGetArtifact(tx, created.id);
          return laidOut ?? created;
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
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
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
            await ensurePrototypeLayout(tx, updated.prototypeId);
            return (await dbGetArtifact(tx, updated.id)) ?? updated;
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

    /**
     * Move a screen to another prototype in the same project. Keeps artifact
     * id and comments. Does not rewrite markup — re-runs the write-time scan
     * so prototype_links match title resolution in the destination.
     */
    async move(id: string, prototypeId: string): Promise<SerializedArtifact | undefined> {
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

      if (existing.prototypeId === null || existing.kind !== 'html') {
        throw new InvalidArtifactError('move requires an html screen attached to a prototype');
      }
      if (existing.prototypeId === prototypeId) {
        return serializeArtifact(existing, await resolveRevisionId(db, existing));
      }

      await resolvePrototypeForWrite(db, existing.projectId, prototypeId, 'html');
      assertScreenContentAllowed(existing.content);

      const sourcePrototypeId = existing.prototypeId;

      const artifact = await withTransaction(db, async (tx) => {
        const updated = await dbUpdateArtifact(tx, id, { prototypeId });
        if (!updated || !updated.prototypeId) {
          return undefined;
        }

        await applyScreenContentScan(tx, {
          projectId: updated.projectId,
          artifactId: updated.id,
          prototypeId: updated.prototypeId,
          content: updated.content,
        });

        // Drop prior flow-document edge; attach to the destination's.
        const oldEdges = await listEdgesByEndpoint(tx, updated.projectId, 'artifact', updated.id);
        for (const edge of oldEdges) {
          if (
            edge.fromType === 'artifact' &&
            edge.fromId === updated.id &&
            edge.toType === 'document'
          ) {
            await deleteEdgeByEndpoints(tx, updated.projectId, {
              fromType: edge.fromType,
              fromId: edge.fromId,
              toType: edge.toType,
              toId: edge.toId,
            });
          }
        }
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

        await ensurePrototypeLayout(tx, updated.prototypeId);
        if (sourcePrototypeId) {
          await ensurePrototypeLayout(tx, sourcePrototypeId);
        }
        return (await dbGetArtifact(tx, updated.id)) ?? updated;
      });

      if (!artifact) {
        return undefined;
      }
      return serializeArtifact(artifact, await resolveRevisionId(db, artifact));
    },

    /**
     * Copy a screen into another prototype. New artifact id, same content,
     * comments do not travel. Links resolve by title in the destination —
     * a missing title dangles (null to_artifact_id), never throws.
     */
    async copy(id: string, prototypeId: string): Promise<SerializedArtifact | undefined> {
      assertPermission(deps, 'document', 'create');
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

      if (existing.prototypeId === null || existing.kind !== 'html') {
        throw new InvalidArtifactError('copy requires an html screen attached to a prototype');
      }

      await resolvePrototypeForWrite(db, existing.projectId, prototypeId, 'html');
      assertScreenContentAllowed(existing.content);

      const artifact = await withTransaction(db, async (tx) => {
        const created = await dbCreateArtifact(tx, {
          projectId: existing.projectId,
          title: existing.title,
          kind: 'html',
          content: existing.content,
          prototypeId,
        });

        await applyScreenContentScan(tx, {
          projectId: created.projectId,
          artifactId: created.id,
          prototypeId,
          content: created.content,
        });

        const flowDoc = await findFlowDocumentForPrototype(tx, created.projectId, prototypeId);
        if (flowDoc) {
          await createEdge(tx, {
            projectId: created.projectId,
            fromType: 'artifact',
            fromId: created.id,
            toType: 'document',
            toId: flowDoc.id,
            label: 'documents',
          });
        }

        await ensurePrototypeLayout(tx, prototypeId);
        return (await dbGetArtifact(tx, created.id)) ?? created;
      });

      return serializeArtifact(artifact, await resolveRevisionId(db, artifact));
    },
  };
}

export type ArtifactService = ReturnType<typeof createArtifactService>;
