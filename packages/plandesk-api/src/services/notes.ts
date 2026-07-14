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
    async list(
      projectId: string,
      pagination: PaginationParams = {},
    ): Promise<SerializedNote[] | undefined> {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return (await dbListNotes(db, projectId, pagination)).map(serializeNote);
    },

    async create(projectId: string, input: CreateNoteInput): Promise<SerializedNote | undefined> {
      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      assertNonEmptyTitle(input.title);

      const note = await dbCreateNote(db, {
        projectId,
        title: input.title,
        body: input.body,
      });

      eventBus.emit({ type: 'note_created', noteId: note.id, projectId });

      return serializeNote(note);
    },

    async get(id: string): Promise<SerializedNote | undefined> {
      const note = await dbGetNote(db, id);
      if (!note) {
        return undefined;
      }
      return serializeNote(note);
    },

    async update(id: string, input: UpdateNoteInput): Promise<SerializedNote | undefined> {
      const existing = await dbGetNote(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.title !== undefined) {
        assertNonEmptyTitle(input.title);
      }

      const note = await dbUpdateNote(db, id, input);
      if (!note) {
        return undefined;
      }

      eventBus.emit({ type: 'note_updated', noteId: note.id, projectId: note.projectId });

      return serializeNote(note);
    },

    async delete(id: string): Promise<boolean> {
      const existing = await dbGetNote(db, id);
      if (!existing) {
        return false;
      }

      const deleted = await dbDeleteNote(db, id);
      if (!deleted) {
        return false;
      }

      await deleteCommentsByTarget(db, 'note', id);

      eventBus.emit({ type: 'note_updated', noteId: id, projectId: existing.projectId });
      return true;
    },
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
