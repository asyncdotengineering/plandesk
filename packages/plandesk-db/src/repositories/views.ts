import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  parseSavedViewConfig,
  stringifySavedViewConfig,
  type SavedViewConfig,
} from '../saved-view-config.js';
import { views } from '../schema.js';

export type View = typeof views.$inferSelect;

export type NewView = {
  projectId: string;
  name: string;
  config: SavedViewConfig;
  position?: number;
  id?: string;
};

export type ViewUpdate = {
  name?: string;
  config?: SavedViewConfig;
  position?: number;
};

export async function createView(db: DbClient, input: NewView): Promise<View> {
  const id = input.id ?? randomUUID();
  const configJson = stringifySavedViewConfig(parseSavedViewConfig(input.config));
  const now = new Date();
  const rows = await db
    .insert(views)
    .values({
      id,
      projectId: input.projectId,
      name: input.name,
      config: configJson,
      position: input.position ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create view');
  }
  return row;
}

export async function getView(db: DbClient, id: string): Promise<View | undefined> {
  return db.select().from(views).where(eq(views.id, id)).get();
}

export async function listViews(db: DbClient, projectId: string): Promise<View[]> {
  return db
    .select()
    .from(views)
    .where(eq(views.projectId, projectId))
    .orderBy(asc(views.position), asc(views.createdAt))
    .all();
}

export async function updateView(
  db: DbClient,
  id: string,
  input: ViewUpdate,
): Promise<View | undefined> {
  const patch: {
    name?: string;
    config?: string;
    position?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.config !== undefined) {
    patch.config = stringifySavedViewConfig(parseSavedViewConfig(input.config));
  }
  if (input.position !== undefined) {
    patch.position = input.position;
  }
  const rows = await db.update(views).set(patch).where(eq(views.id, id)).returning().all();
  return rows[0];
}

export async function deleteView(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(views).where(eq(views.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deleteViewsByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(views).where(eq(views.projectId, projectId)).run();
  return result.rowsAffected;
}

export async function getViewInProject(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<View | undefined> {
  return db
    .select()
    .from(views)
    .where(and(eq(views.projectId, projectId), eq(views.id, id)))
    .get();
}

/** Parse the config column; throws InvalidSavedViewConfigError if corrupt. */
export function viewConfig(view: View): SavedViewConfig {
  return parseSavedViewConfig(view.config);
}
