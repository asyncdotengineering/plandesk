import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { projects } from '../schema.js';

export type Project = typeof projects.$inferSelect;
export type NewProject = {
  name: string;
  description?: string | null;
  id?: string;
};

export type ProjectUpdate = {
  name?: string;
  description?: string | null;
  canvasLayout?: string | null;
};

export function createProject(db: DbClient, input: NewProject): Project {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(projects)
    .values({
      id,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create project');
  }
  return row;
}

export function getProject(db: DbClient, id: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function listProjects(db: DbClient): Project[] {
  return db.select().from(projects).all();
}

export function updateProject(db: DbClient, id: string, input: ProjectUpdate): Project | undefined {
  const now = new Date();
  const rows = db
    .update(projects)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(projects.id, id))
    .returning()
    .all();
  return rows[0];
}
