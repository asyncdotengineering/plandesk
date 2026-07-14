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

export async function createNote(db: DbClient, input: NewNote): Promise<Note> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
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

export async function getNote(db: DbClient, id: string): Promise<Note | undefined> {
  return db.select().from(notes).where(eq(notes.id, id)).get();
}

export type ListNotesOptions = {
  limit?: number;
  offset?: number;
};

export async function listNotes(
  db: DbClient,
  projectId: string,
  options?: ListNotesOptions,
): Promise<Note[]> {
  let query = db.select().from(notes).where(eq(notes.projectId, projectId)).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export async function getNoteByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<Note | undefined> {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, projectId), eq(notes.id, id)))
    .get();
}

export async function updateNote(
  db: DbClient,
  id: string,
  input: NoteUpdate,
): Promise<Note | undefined> {
  const now = new Date();
  const rows = await db
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

export async function deleteNote(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(notes).where(eq(notes.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deleteNotesByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(notes).where(eq(notes.projectId, projectId)).run();
  return result.rowsAffected;
}
