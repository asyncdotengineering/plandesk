import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { notes } from '../schema.js';

export type Note = typeof notes.$inferSelect;

export type NewNote = {
  projectId: string;
  title: string;
  body?: string | null;
  id?: string;
};

export type NoteUpdate = {
  title?: string;
  body?: string | null;
};

export function createNote(db: DbClient, input: NewNote): Note {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(notes)
    .values({
      id,
      projectId: input.projectId,
      title: input.title,
      body: input.body ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create note');
  }
  return row;
}

export function getNote(db: DbClient, id: string): Note | undefined {
  return db.select().from(notes).where(eq(notes.id, id)).get();
}

export type ListNotesOptions = {
  limit?: number;
  offset?: number;
};

export function listNotes(db: DbClient, projectId: string, options?: ListNotesOptions): Note[] {
  let query = db.select().from(notes).where(eq(notes.projectId, projectId)).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export function getNoteByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Note | undefined {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, projectId), eq(notes.id, id)))
    .get();
}

export function updateNote(db: DbClient, id: string, input: NoteUpdate): Note | undefined {
  const now = new Date();
  const rows = db
    .update(notes)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(notes.id, id))
    .returning()
    .all();
  return rows[0];
}

export function deleteNote(db: DbClient, id: string): boolean {
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  return result.changes > 0;
}

export function deleteNotesByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(notes).where(eq(notes.projectId, projectId)).run();
  return result.changes;
}
