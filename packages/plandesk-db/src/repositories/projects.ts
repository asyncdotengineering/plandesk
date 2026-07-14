import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { projects } from '../schema.js';

export type Project = typeof projects.$inferSelect;
export type NewProject = {
  name: string;
  orgId: string;
  description?: string | null;
  id?: string;
};

export type ProjectUpdate = {
  name?: string;
  description?: string | null;
  canvasLayout?: string | null;
};

export async function createProject(db: DbClient, input: NewProject): Promise<Project> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(projects)
    .values({
      id,
      orgId: input.orgId,
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

export async function getProject(db: DbClient, id: string): Promise<Project | undefined> {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export async function getProjectInOrg(
  db: DbClient,
  projectId: string,
  orgId: string,
): Promise<Project | undefined> {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .get();
}

export type ListProjectsOptions = {
  limit?: number;
  offset?: number;
};

export async function listProjects(
  db: DbClient,
  orgId: string,
  options?: ListProjectsOptions,
): Promise<Project[]> {
  let query = db.select().from(projects).where(eq(projects.orgId, orgId)).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export async function deleteProject(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(projects).where(eq(projects.id, id)).run();
  return result.rowsAffected > 0;
}

export async function updateProject(
  db: DbClient,
  id: string,
  input: ProjectUpdate,
): Promise<Project | undefined> {
  const now = new Date();
  const rows = await db
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
