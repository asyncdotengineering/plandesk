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

export type ListProjectsOptions = {
  limit?: number;
  offset?: number;
};

export function listProjects(db: DbClient, options?: ListProjectsOptions): Project[] {
  let query = db.select().from(projects).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export function deleteProject(db: DbClient, id: string): boolean {
  const result = db.delete(projects).where(eq(projects.id, id)).run();
  return result.changes > 0;
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
