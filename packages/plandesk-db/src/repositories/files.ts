import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { files, projects } from '../schema.js';

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
    .onConflictDoNothing({ target: [files.projectId, files.id] })
    .returning()
    .all();
  const row = rows[0] ?? (await getFile(db, input.projectId, input.id));
  if (!row) {
    throw new Error('Failed to create file');
  }
  return row;
}

export async function getFile(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<File | undefined> {
  return db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.id, id)))
    .get();
}

/** Resolve a content-hash id within an org (no cross-org leakage). */
export async function getFileInOrg(
  db: DbClient,
  fileId: string,
  orgId: string,
): Promise<File | undefined> {
  const row = await db
    .select({
      id: files.id,
      projectId: files.projectId,
      filename: files.filename,
      mime: files.mime,
      size: files.size,
      bytes: files.bytes,
      externalUrl: files.externalUrl,
      createdAt: files.createdAt,
    })
    .from(files)
    .innerJoin(projects, eq(files.projectId, projects.id))
    .where(and(eq(files.id, fileId), eq(projects.orgId, orgId)))
    .get();
  return row;
}

export async function listFilesByProject(db: DbClient, projectId: string): Promise<File[]> {
  return db.select().from(files).where(eq(files.projectId, projectId)).all();
}
