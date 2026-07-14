import {
  createComment,
  deleteComment as dbDeleteComment,
  getComment as dbGetComment,
  getDocument as dbGetDocument,
  getNote as dbGetNote,
  getProject,
  getSubmission,
  getTask,
  listCommentsByProject as dbListCommentsByProject,
  listCommentsByTarget as dbListCommentsByTarget,
  updateComment as dbUpdateComment,
  type CommentTargetType,
  type Db,
} from '@plandesk/db';
import { serializeComment, type SerializedComment } from '../serialize.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type CommentServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CommentTarget = {
  type: CommentTargetType;
  id: string;
};

export type CreateCommentInput = {
  body: string;
  passage?: string | null;
  anchor?: string | null;
};

export type UpdateCommentInput = {
  body?: string;
  resolved?: boolean;
};

export class InvalidCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommentError';
  }
}

function assertNonEmptyBody(body: string): void {
  if (body.trim() === '') {
    throw new InvalidCommentError('Comment body must not be empty');
  }
}

async function targetProjectId(
  db: Db,
  target: { type: CommentTargetType; id: string },
): Promise<string | undefined> {
  switch (target.type) {
    case 'document':
      return (await dbGetDocument(db, target.id))?.projectId;
    case 'task':
      return (await getTask(db, target.id))?.projectId;
    case 'note':
      return (await dbGetNote(db, target.id))?.projectId;
    case 'submission':
      return (await getSubmission(db, target.id))?.projectId;
    case 'artifact':
      // An artifact is a file on disk, not a DB entity — its project is
      // supplied by the caller (the connected repo's project), not resolved
      // from the target id. Artifact comments go through createForArtifact.
      return undefined;
  }
}

export function createCommentService(deps: CommentServiceDeps) {
  const { db } = deps;

  return {
    async create(
      target: CommentTarget,
      input: CreateCommentInput,
    ): Promise<SerializedComment | undefined> {
      const projectId = await targetProjectId(db, target);
      if (!projectId) {
        return undefined;
      }

      assertNonEmptyBody(input.body);

      const comment = await createComment(db, {
        projectId,
        targetType: target.type,
        targetId: target.id,
        body: input.body,
        passage: input.passage,
        anchor: input.anchor,
      });

      return serializeComment(comment);
    },

    // Artifact comments are project-scoped: the caller supplies the project
    // (the connected repo's), and the file identity is the target id. Slashes
    // in the file identity mean it travels in the body/query, never a path seg.
    async createForArtifact(
      projectId: string,
      artifactId: string,
      input: CreateCommentInput,
    ): Promise<SerializedComment | undefined> {
      if (!(await getProject(db, projectId))) {
        return undefined;
      }
      if (artifactId.trim() === '') {
        throw new InvalidCommentError('Artifact id must not be empty');
      }
      assertNonEmptyBody(input.body);

      const comment = await createComment(db, {
        projectId,
        targetType: 'artifact',
        targetId: artifactId,
        body: input.body,
        passage: input.passage,
        anchor: input.anchor,
      });

      return serializeComment(comment);
    },

    async listForArtifact(
      projectId: string,
      artifactId: string,
      options?: { includeResolved?: boolean },
    ): Promise<SerializedComment[] | undefined> {
      if (!(await getProject(db, projectId))) {
        return undefined;
      }
      return (await dbListCommentsByTarget(db, 'artifact', artifactId, options)).map(
        serializeComment,
      );
    },

    async listByTarget(
      target: CommentTarget,
      options?: { includeResolved?: boolean },
    ): Promise<SerializedComment[] | undefined> {
      const projectId = await targetProjectId(db, target);
      if (!projectId) {
        return undefined;
      }
      return (await dbListCommentsByTarget(db, target.type, target.id, options)).map(
        serializeComment,
      );
    },

    async resolveTargetProjectId(target: CommentTarget): Promise<string | undefined> {
      return targetProjectId(db, target);
    },

    async listByDocument(
      documentId: string,
      options?: { includeResolved?: boolean },
    ): Promise<SerializedComment[] | undefined> {
      return this.listByTarget({ type: 'document', id: documentId }, options);
    },

    async listByProject(
      projectId: string,
      options?: { includeResolved?: boolean },
    ): Promise<SerializedComment[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListCommentsByProject(db, projectId, options)).map(serializeComment);
    },

    async update(id: string, input: UpdateCommentInput): Promise<SerializedComment | undefined> {
      const existing = await dbGetComment(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.body !== undefined) {
        assertNonEmptyBody(input.body);
      }

      const comment = await dbUpdateComment(db, id, input);
      if (!comment) {
        return undefined;
      }

      const projectId = await targetProjectId(db, {
        type: comment.targetType,
        id: comment.targetId,
      });
      if (!projectId) {
        return undefined;
      }

      return serializeComment(comment);
    },

    async delete(id: string): Promise<boolean> {
      const existing = await dbGetComment(db, id);
      if (!existing) {
        return false;
      }

      const projectId = await targetProjectId(db, {
        type: existing.targetType,
        id: existing.targetId,
      });
      if (!projectId) {
        return false;
      }

      const deleted = await dbDeleteComment(db, id);
      if (!deleted) {
        return false;
      }

      return true;
    },
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
