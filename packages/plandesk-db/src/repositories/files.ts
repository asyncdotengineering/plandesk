import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { files } from '../schema.js';

export type File = typeof files.$inferSelect;

export type NewFile = {
  id: string;
  projectId: string;
  filename: string;
  mime: string;
  size: number;
  bytes?: Buffer | null;
  externalUrl?: string | null;
  createdAt?: string;
};

export async function createFile(db: DbClient, input: NewFile): Promise<File> {
  const rows = await db
    .insert(files)
    .values({
      id: input.id,
      projectId: input.projectId,
      filename: input.filename,
      mime: input.mime,
      size: input.size,
      bytes: input.bytes ?? null,
      externalUrl: input.externalUrl ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    })
    .onConflictDoNothing({ target: files.id })
    .returning()
    .all();
  const row = rows[0] ?? (await getFile(db, input.id));
  if (!row) {
    throw new Error('Failed to create file');
  }
  return row;
}

export async function getFile(db: DbClient, id: string): Promise<File | undefined> {
  return db.select().from(files).where(eq(files.id, id)).get();
}

export async function listFilesByProject(db: DbClient, projectId: string): Promise<File[]> {
  return db.select().from(files).where(eq(files.projectId, projectId)).all();
}
