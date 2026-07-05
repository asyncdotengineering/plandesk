import {
  createNote as dbCreateNote,
  deleteCommentsByTarget,
  deleteNote as dbDeleteNote,
  getNote as dbGetNote,
  getProject,
  listNotes as dbListNotes,
  updateNote as dbUpdateNote,
  type Db,
} from '@plandesk/db';
import { serializeNote, type PaginationParams, type SerializedNote } from '../serialize.js';
import type { EventBus } from '../events.js';

export type NoteServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CreateNoteInput = {
  title: string;
  body?: string | null;
};

export type UpdateNoteInput = {
  title?: string;
  body?: string | null;
};

export class InvalidNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNoteError';
  }
}

function assertNonEmptyTitle(title: string): void {
  if (title.trim() === '') {
    throw new InvalidNoteError('Note title must not be empty');
  }
}

export function createNoteService(deps: NoteServiceDeps) {
  const { db, eventBus } = deps;

  return {
    list(projectId: string, pagination: PaginationParams = {}): SerializedNote[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return dbListNotes(db, projectId, pagination).map(serializeNote);
    },

    create(projectId: string, input: CreateNoteInput): SerializedNote | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      assertNonEmptyTitle(input.title);

      const note = dbCreateNote(db, {
        projectId,
        title: input.title,
        body: input.body,
      });

      eventBus.emit({ type: 'note_created', noteId: note.id, projectId });

      return serializeNote(note);
    },

    get(id: string): SerializedNote | undefined {
      const note = dbGetNote(db, id);
      if (!note) {
        return undefined;
      }
      return serializeNote(note);
    },

    update(id: string, input: UpdateNoteInput): SerializedNote | undefined {
      const existing = dbGetNote(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.title !== undefined) {
        assertNonEmptyTitle(input.title);
      }

      const note = dbUpdateNote(db, id, input);
      if (!note) {
        return undefined;
      }

      eventBus.emit({ type: 'note_updated', noteId: note.id, projectId: note.projectId });

      return serializeNote(note);
    },

    delete(id: string): boolean {
      const existing = dbGetNote(db, id);
      if (!existing) {
        return false;
      }

      const deleted = dbDeleteNote(db, id);
      if (!deleted) {
        return false;
      }

      deleteCommentsByTarget(db, 'note', id);

      eventBus.emit({ type: 'note_updated', noteId: id, projectId: existing.projectId });
      return true;
    },
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
