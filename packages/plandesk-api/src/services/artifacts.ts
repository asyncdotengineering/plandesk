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

export type ArtifactServiceDeps = {
  db: Db;
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
  const { db } = deps;

  return {
    async listByProject(projectId: string): Promise<SerializedArtifactSummary[] | undefined> {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return (await dbListArtifactsByProject(db, projectId)).map(serializeArtifactSummary);
    },

    async create(
      projectId: string,
      input: CreateArtifactInput,
    ): Promise<SerializedArtifact | undefined> {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      assertNonEmptyTitle(input.title);

      const artifact = await dbCreateArtifact(db, {
        projectId,
        title: input.title,
        kind: input.kind,
        content: input.content,
      });

      return serializeArtifact(artifact);
    },

    async get(id: string): Promise<SerializedArtifact | undefined> {
      const artifact = await dbGetArtifact(db, id);
      if (!artifact) {
        return undefined;
      }
      return serializeArtifact(artifact);
    },

    async update(id: string, input: UpdateArtifactInput): Promise<SerializedArtifact | undefined> {
      const existing = await dbGetArtifact(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.title !== undefined) {
        assertNonEmptyTitle(input.title);
      }

      const artifact = await dbUpdateArtifact(db, id, input);
      if (!artifact) {
        return undefined;
      }

      return serializeArtifact(artifact);
    },
  };
}

export type ArtifactService = ReturnType<typeof createArtifactService>;
