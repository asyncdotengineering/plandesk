import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { artifacts, type ArtifactKind } from '../schema.js';

export type Artifact = typeof artifacts.$inferSelect;

export type NewArtifact = {
  projectId: string;
  title: string;
  kind?: ArtifactKind;
  content?: string;
  prototypeId?: string | null;
  x?: number | null;
  y?: number | null;
  id?: string;
};

export type ArtifactUpdate = {
  title?: string;
  kind?: ArtifactKind;
  content?: string;
  prototypeId?: string | null;
  x?: number | null;
  y?: number | null;
};

export async function createArtifact(db: DbClient, input: NewArtifact): Promise<Artifact> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(artifacts)
    .values({
      id,
      projectId: input.projectId,
      title: input.title,
      kind: input.kind ?? 'markdown',
      content: input.content ?? '',
      prototypeId: input.prototypeId ?? null,
      x: input.x ?? null,
      y: input.y ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create artifact');
  }
  return row;
}

export async function getArtifact(db: DbClient, id: string): Promise<Artifact | undefined> {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get();
}

export async function listArtifactsByProject(db: DbClient, projectId: string): Promise<Artifact[]> {
  return db.select().from(artifacts).where(eq(artifacts.projectId, projectId)).all();
}

export async function listArtifactsByPrototype(
  db: DbClient,
  prototypeId: string,
): Promise<Artifact[]> {
  return db.select().from(artifacts).where(eq(artifacts.prototypeId, prototypeId)).all();
}

export async function getArtifactByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<Artifact | undefined> {
  return db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, projectId), eq(artifacts.id, id)))
    .get();
}

export async function updateArtifact(
  db: DbClient,
  id: string,
  input: ArtifactUpdate,
): Promise<Artifact | undefined> {
  const now = new Date();
  const rows = await db
    .update(artifacts)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(artifacts.id, id))
    .returning()
    .all();
  return rows[0];
}

export async function deleteArtifactsByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(artifacts).where(eq(artifacts.projectId, projectId)).run();
  return result.rowsAffected;
}
