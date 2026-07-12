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
  id?: string;
};

export type ArtifactUpdate = {
  title?: string;
  kind?: ArtifactKind;
  content?: string;
};

export function createArtifact(db: DbClient, input: NewArtifact): Artifact {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(artifacts)
    .values({
      id,
      projectId: input.projectId,
      title: input.title,
      kind: input.kind ?? 'markdown',
      content: input.content ?? '',
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

export function getArtifact(db: DbClient, id: string): Artifact | undefined {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get();
}

export function listArtifactsByProject(db: DbClient, projectId: string): Artifact[] {
  return db.select().from(artifacts).where(eq(artifacts.projectId, projectId)).all();
}

export function getArtifactByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Artifact | undefined {
  return db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.projectId, projectId), eq(artifacts.id, id)))
    .get();
}

export function updateArtifact(
  db: DbClient,
  id: string,
  input: ArtifactUpdate,
): Artifact | undefined {
  const now = new Date();
  const rows = db
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