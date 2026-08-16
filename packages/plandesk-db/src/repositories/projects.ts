import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { projects } from '../schema.js';

export type Project = typeof projects.$inferSelect;
export type NewProject = {
  name: string;
  orgId: string;
  workspaceId: string;
  description?: string | null;
  ownerId?: string | null;
  overviewDocumentId?: string | null;
  repoUrl?: string | null;
  folderPath?: string | null;
  id?: string;
};

export type ProjectUpdate = {
  name?: string;
  description?: string | null;
  ownerId?: string | null;
  overviewDocumentId?: string | null;
  currentGoalId?: string | null;
  repoUrl?: string | null;
  folderPath?: string | null;
  canvasLayout?: string | null;
  workspaceId?: string;
};

export async function createProject(db: DbClient, input: NewProject): Promise<Project> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(projects)
    .values({
      id,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      ownerId: input.ownerId ?? null,
      overviewDocumentId: input.overviewDocumentId ?? null,
      repoUrl: input.repoUrl ?? null,
      folderPath: input.folderPath ?? null,
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
  workspaceId?: string;
  /**
   * Restrict to projects in this set of workspaces (session members gated to
   * their teams). Empty array → no projects (fail-closed).
   */
  workspaceIds?: string[];
};

export async function listProjects(
  db: DbClient,
  orgId: string,
  options?: ListProjectsOptions,
): Promise<Project[]> {
  if (options?.workspaceIds !== undefined && options.workspaceIds.length === 0) {
    return [];
  }
  const conditions = [eq(projects.orgId, orgId)];
  if (options?.workspaceId !== undefined) {
    conditions.push(eq(projects.workspaceId, options.workspaceId));
  }
  if (options?.workspaceIds !== undefined) {
    conditions.push(inArray(projects.workspaceId, options.workspaceIds));
  }
  const [onlyCondition] = conditions;
  const filter =
    conditions.length === 1 && onlyCondition !== undefined ? onlyCondition : and(...conditions);
  let query = db.select().from(projects).where(filter).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

/**
 * List every project in a workspace. A workspace_id is a better-auth team id
 * (globally unique), so filtering by it alone cannot cross org boundaries —
 * the result is exactly one workspace's projects in one org.
 */
export async function listProjectsByWorkspace(
  db: DbClient,
  workspaceId: string,
): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.workspaceId, workspaceId)).all();
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

export async function setProjectCurrentGoalId(
  db: DbClient,
  projectId: string,
  goalId: string | null,
): Promise<Project | undefined> {
  const now = new Date();
  const rows = await db
    .update(projects)
    .set({ currentGoalId: goalId, updatedAt: now })
    .where(eq(projects.id, projectId))
    .returning()
    .all();
  return rows[0];
}

/**
 * Clear overview_document_id on any project that pins this document.
 * SQLite ALTER ADD COLUMN REFERENCES does not carry ON DELETE SET NULL, so
 * application code must null the pin before the document row is removed.
 */
export async function clearOverviewDocumentRefs(db: DbClient, documentId: string): Promise<number> {
  const now = new Date();
  const result = await db
    .update(projects)
    .set({ overviewDocumentId: null, updatedAt: now })
    .where(eq(projects.overviewDocumentId, documentId))
    .run();
  return result.rowsAffected;
}
