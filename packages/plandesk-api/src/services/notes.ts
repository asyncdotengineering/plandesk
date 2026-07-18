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
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type NoteServiceDeps = OrgScopedDeps & {
  db: Db;
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
  const { db } = deps;

  return {
    async list(
      projectId: string,
      pagination: PaginationParams = {},
    ): Promise<SerializedNote[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListNotes(db, projectId, pagination)).map(serializeNote);
    },

    async create(projectId: string, input: CreateNoteInput): Promise<SerializedNote | undefined> {
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

      const note = await dbCreateNote(db, {
        projectId,
        title: input.title,
        body: input.body,
      });

      return serializeNote(note);
    },

    async get(id: string): Promise<SerializedNote | undefined> {
      const note = await dbGetNote(db, id);
      if (!note) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, note.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return serializeNote(note);
    },

    async update(id: string, input: UpdateNoteInput): Promise<SerializedNote | undefined> {
      assertPermission(deps, 'document', 'update');
      const existing = await dbGetNote(db, id);
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

      const note = await dbUpdateNote(db, id, input);
      if (!note) {
        return undefined;
      }

      return serializeNote(note);
    },

    async delete(id: string): Promise<boolean> {
      assertPermission(deps, 'document', 'delete');
      const existing = await dbGetNote(db, id);
      if (!existing) {
        return false;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      const deleted = await dbDeleteNote(db, id);
      if (!deleted) {
        return false;
      }

      await deleteCommentsByTarget(db, 'note', id);

      return true;
    },
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
