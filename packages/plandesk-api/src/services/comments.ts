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
import type { EventBus } from '../events.js';
import { serializeComment, type SerializedComment } from '../serialize.js';

export type CommentServiceDeps = {
  db: Db;
  eventBus: EventBus;
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

function targetProjectId(
  db: Db,
  target: { type: CommentTargetType; id: string },
): string | undefined {
  switch (target.type) {
    case 'document':
      return dbGetDocument(db, target.id)?.projectId;
    case 'task':
      return getTask(db, target.id)?.projectId;
    case 'note':
      return dbGetNote(db, target.id)?.projectId;
    case 'submission':
      return getSubmission(db, target.id)?.projectId;
    case 'artifact':
      // An artifact is a file on disk, not a DB entity — its project is
      // supplied by the caller (the connected repo's project), not resolved
      // from the target id. Artifact comments go through createForArtifact.
      return undefined;
  }
}

function emitCommentCreated(
  eventBus: EventBus,
  commentId: string,
  projectId: string,
  target: { type: CommentTargetType; id: string },
): void {
  eventBus.emit({
    type: 'comment_created',
    commentId,
    projectId,
    target_type: target.type,
    target_id: target.id,
    ...(target.type === 'document' ? { documentId: target.id } : {}),
  });
}

function emitCommentUpdated(
  eventBus: EventBus,
  commentId: string,
  projectId: string,
  target: { type: CommentTargetType; id: string },
): void {
  eventBus.emit({
    type: 'comment_updated',
    commentId,
    projectId,
    target_type: target.type,
    target_id: target.id,
    ...(target.type === 'document' ? { documentId: target.id } : {}),
  });
}

export function createCommentService(deps: CommentServiceDeps) {
  const { db, eventBus } = deps;

  return {
    create(target: CommentTarget, input: CreateCommentInput): SerializedComment | undefined {
      const projectId = targetProjectId(db, target);
      if (!projectId) {
        return undefined;
      }

      assertNonEmptyBody(input.body);

      const comment = createComment(db, {
        projectId,
        targetType: target.type,
        targetId: target.id,
        body: input.body,
        passage: input.passage,
        anchor: input.anchor,
      });

      emitCommentCreated(eventBus, comment.id, projectId, target);

      return serializeComment(comment);
    },

    // Artifact comments are project-scoped: the caller supplies the project
    // (the connected repo's), and the file identity is the target id. Slashes
    // in the file identity mean it travels in the body/query, never a path seg.
    createForArtifact(
      projectId: string,
      artifactId: string,
      input: CreateCommentInput,
    ): SerializedComment | undefined {
      if (!getProject(db, projectId)) {
        return undefined;
      }
      if (artifactId.trim() === '') {
        throw new InvalidCommentError('Artifact id must not be empty');
      }
      assertNonEmptyBody(input.body);

      const target = { type: 'artifact' as const, id: artifactId };
      const comment = createComment(db, {
        projectId,
        targetType: 'artifact',
        targetId: artifactId,
        body: input.body,
        passage: input.passage,
        anchor: input.anchor,
      });

      emitCommentCreated(eventBus, comment.id, projectId, target);

      return serializeComment(comment);
    },

    listForArtifact(
      projectId: string,
      artifactId: string,
      options?: { includeResolved?: boolean },
    ): SerializedComment[] | undefined {
      if (!getProject(db, projectId)) {
        return undefined;
      }
      return dbListCommentsByTarget(db, 'artifact', artifactId, options).map(serializeComment);
    },

    listByTarget(
      target: CommentTarget,
      options?: { includeResolved?: boolean },
    ): SerializedComment[] | undefined {
      const projectId = targetProjectId(db, target);
      if (!projectId) {
        return undefined;
      }
      return dbListCommentsByTarget(db, target.type, target.id, options).map(serializeComment);
    },

    resolveTargetProjectId(target: CommentTarget): string | undefined {
      return targetProjectId(db, target);
    },

    listByDocument(
      documentId: string,
      options?: { includeResolved?: boolean },
    ): SerializedComment[] | undefined {
      return this.listByTarget({ type: 'document', id: documentId }, options);
    },

    listByProject(
      projectId: string,
      options?: { includeResolved?: boolean },
    ): SerializedComment[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return dbListCommentsByProject(db, projectId, options).map(serializeComment);
    },

    update(id: string, input: UpdateCommentInput): SerializedComment | undefined {
      const existing = dbGetComment(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.body !== undefined) {
        assertNonEmptyBody(input.body);
      }

      const comment = dbUpdateComment(db, id, input);
      if (!comment) {
        return undefined;
      }

      const projectId = targetProjectId(db, {
        type: comment.targetType,
        id: comment.targetId,
      });
      if (!projectId) {
        return undefined;
      }

      emitCommentUpdated(eventBus, id, projectId, {
        type: comment.targetType,
        id: comment.targetId,
      });

      return serializeComment(comment);
    },

    delete(id: string): boolean {
      const existing = dbGetComment(db, id);
      if (!existing) {
        return false;
      }

      const projectId = targetProjectId(db, {
        type: existing.targetType,
        id: existing.targetId,
      });
      if (!projectId) {
        return false;
      }

      const deleted = dbDeleteComment(db, id);
      if (!deleted) {
        return false;
      }

      emitCommentUpdated(eventBus, id, projectId, {
        type: existing.targetType,
        id: existing.targetId,
      });

      return true;
    },
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
