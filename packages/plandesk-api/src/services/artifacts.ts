import {
  createArtifact as dbCreateArtifact,
  getArtifact as dbGetArtifact,
  getProject,
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
import type { EventBus } from '../events.js';

export type ArtifactServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CreateArtifactInput = {
  title: string;
  kind?: ArtifactKind;
  content?: string;
};

export type UpdateArtifactInput = {
  title?: string;
  kind?: ArtifactKind;
  content?: string;
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

export function createArtifactService(deps: ArtifactServiceDeps) {
  const { db, eventBus } = deps;

  return {
    listByProject(projectId: string): SerializedArtifactSummary[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return dbListArtifactsByProject(db, projectId).map(serializeArtifactSummary);
    },

    create(projectId: string, input: CreateArtifactInput): SerializedArtifact | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      assertNonEmptyTitle(input.title);

      const artifact = dbCreateArtifact(db, {
        projectId,
        title: input.title,
        kind: input.kind,
        content: input.content,
      });

      eventBus.emit({
        type: 'artifact_created',
        artifactId: artifact.id,
        projectId,
      });

      return serializeArtifact(artifact);
    },

    get(id: string): SerializedArtifact | undefined {
      const artifact = dbGetArtifact(db, id);
      if (!artifact) {
        return undefined;
      }
      return serializeArtifact(artifact);
    },

    update(id: string, input: UpdateArtifactInput): SerializedArtifact | undefined {
      const existing = dbGetArtifact(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.title !== undefined) {
        assertNonEmptyTitle(input.title);
      }

      const artifact = dbUpdateArtifact(db, id, input);
      if (!artifact) {
        return undefined;
      }

      eventBus.emit({
        type: 'artifact_updated',
        artifactId: artifact.id,
        projectId: artifact.projectId,
      });

      return serializeArtifact(artifact);
    },
  };
}

export type ArtifactService = ReturnType<typeof createArtifactService>;