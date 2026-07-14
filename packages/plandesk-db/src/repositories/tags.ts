import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { tags, taskTags, tasks } from '../schema.js';

export type Tag = typeof tags.$inferSelect;

export type NewTag = {
  projectId: string;
  name: string;
  color?: string | null;
  id?: string;
};

export type TagUpdate = {
  name?: string;
  color?: string | null;
};

export async function createTag(db: DbClient, input: NewTag): Promise<Tag> {
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(tags)
    .values({
      id,
      projectId: input.projectId,
      name: input.name,
      color: input.color ?? null,
      createdAt: new Date(),
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create tag');
  }
  return row;
}

export async function getTag(db: DbClient, id: string): Promise<Tag | undefined> {
  return db.select().from(tags).where(eq(tags.id, id)).get();
}

export async function getTagByName(
  db: DbClient,
  projectId: string,
  name: string,
): Promise<Tag | undefined> {
  return db
    .select()
    .from(tags)
    .where(and(eq(tags.projectId, projectId), eq(tags.name, name)))
    .get();
}

export async function listTags(db: DbClient, projectId: string): Promise<Tag[]> {
  return db.select().from(tags).where(eq(tags.projectId, projectId)).orderBy(asc(tags.name)).all();
}

export async function updateTag(
  db: DbClient,
  id: string,
  input: TagUpdate,
): Promise<Tag | undefined> {
  const rows = await db.update(tags).set(input).where(eq(tags.id, id)).returning().all();
  return rows[0];
}

// Removes the tag from every task (join rows), then the tag row itself.
export async function deleteTag(db: DbClient, id: string): Promise<boolean> {
  await db.delete(taskTags).where(eq(taskTags.tagId, id)).run();
  const result = await db.delete(tags).where(eq(tags.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deleteTagsByProjectId(db: DbClient, projectId: string): Promise<number> {
  await db
    .delete(taskTags)
    .where(
      inArray(
        taskTags.tagId,
        db.select({ id: tags.id }).from(tags).where(eq(tags.projectId, projectId)),
      ),
    )
    .run();
  const result = await db.delete(tags).where(eq(tags.projectId, projectId)).run();
  return result.rowsAffected;
}

// Replaces the task's tag set with exactly the given tag ids.
export async function setTaskTags(db: DbClient, taskId: string, tagIds: string[]): Promise<void> {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId)).run();
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) {
    return;
  }
  await db
    .insert(taskTags)
    .values(unique.map((tagId) => ({ taskId, tagId })))
    .run();
}

export async function listTagsForTask(db: DbClient, taskId: string): Promise<Tag[]> {
  return db
    .select({
      id: tags.id,
      projectId: tags.projectId,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
    })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .where(eq(taskTags.taskId, taskId))
    .orderBy(asc(tags.name))
    .all();
}

export async function listTagsByTaskForProject(
  db: DbClient,
  projectId: string,
): Promise<Map<string, Tag[]>> {
  const rows = await db
    .select({
      taskId: taskTags.taskId,
      id: tags.id,
      projectId: tags.projectId,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
    })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .where(eq(tags.projectId, projectId))
    .orderBy(asc(tags.name))
    .all();
  const byTask = new Map<string, Tag[]>();
  for (const { taskId, ...tag } of rows) {
    const list = byTask.get(taskId);
    if (list) {
      list.push(tag);
    } else {
      byTask.set(taskId, [tag]);
    }
  }
  return byTask;
}

// OR semantics: a task matches when it carries ANY of the given tag names.
export async function taskIdsWithAnyTagName(
  db: DbClient,
  projectId: string,
  names: string[],
): Promise<Set<string>> {
  if (names.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectDistinct({ taskId: taskTags.taskId })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .innerJoin(tasks, eq(taskTags.taskId, tasks.id))
    .where(and(eq(tags.projectId, projectId), inArray(tags.name, names)))
    .all();
  return new Set(rows.map((row) => row.taskId));
}

export async function deleteTaskTagsByTaskId(db: DbClient, taskId: string): Promise<number> {
  const result = await db.delete(taskTags).where(eq(taskTags.taskId, taskId)).run();
  return result.rowsAffected;
}
