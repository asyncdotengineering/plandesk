import {
  createComment,
  deleteComment as dbDeleteComment,
  getComment as dbGetComment,
  getDocument as dbGetDocument,
  getProject,
  listCommentsByProject as dbListCommentsByProject,
  listCommentsByTarget as dbListCommentsByTarget,
  updateComment as dbUpdateComment,
  type Db,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeComment, type SerializedComment } from '../serialize.js';

export type CommentServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CreateCommentInput = {
  body: string;
  passage?: string | null;
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

export function createCommentService(deps: CommentServiceDeps) {
  const { db, eventBus } = deps;

  return {
    create(documentId: string, input: CreateCommentInput): SerializedComment | undefined {
      const document = dbGetDocument(db, documentId);
      if (!document) {
        return undefined;
      }

      assertNonEmptyBody(input.body);

      const comment = createComment(db, {
        projectId: document.projectId,
        targetType: 'document',
        targetId: documentId,
        body: input.body,
        passage: input.passage,
      });

      eventBus.emit({
        type: 'comment_created',
        commentId: comment.id,
        documentId,
        projectId: document.projectId,
      });

      return serializeComment(comment);
    },

    listByDocument(
      documentId: string,
      options?: { includeResolved?: boolean },
    ): SerializedComment[] | undefined {
      const document = dbGetDocument(db, documentId);
      if (!document) {
        return undefined;
      }
      return dbListCommentsByTarget(db, 'document', documentId, options).map(serializeComment);
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

      if (comment.targetType !== 'document') {
        return undefined;
      }

      const document = dbGetDocument(db, comment.targetId);
      if (!document) {
        return undefined;
      }

      eventBus.emit({
        type: 'comment_updated',
        commentId: id,
        documentId: comment.targetId,
        projectId: document.projectId,
      });

      return serializeComment(comment);
    },

    delete(id: string): boolean {
      const existing = dbGetComment(db, id);
      if (!existing) {
        return false;
      }

      if (existing.targetType !== 'document') {
        return false;
      }

      const document = dbGetDocument(db, existing.targetId);
      if (!document) {
        return false;
      }

      const deleted = dbDeleteComment(db, id);
      if (!deleted) {
        return false;
      }

      eventBus.emit({
        type: 'comment_updated',
        commentId: id,
        documentId: existing.targetId,
        projectId: document.projectId,
      });

      return true;
    },
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
