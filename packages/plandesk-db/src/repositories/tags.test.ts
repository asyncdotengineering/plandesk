import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import { deleteTask, getTask } from './tasks.js';
import {
  createTag,
  deleteTag,
  deleteTagsByProjectId,
  deleteTaskTagsByTaskId,
  getTag,
  getTagByName,
  listTags,
  listTagsByTaskForProject,
  listTagsForTask,
  setTaskTags,
  taskIdsWithAnyTagName,
  updateTag,
} from './tags.js';

describe('tags repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    projectId = (await createProject(db, { name: 'Tags' })).id;
  });

  it('creates and retrieves a tag', async () => {
    const created = await createTag(db, { projectId, name: 'backend', color: '#ff0000' });
    const fetched = await getTag(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.name).toBe('backend');
    expect(fetched?.color).toBe('#ff0000');
  });

  it('defaults color to null', async () => {
    const created = await createTag(db, { projectId, name: 'plain' });
    expect(created.color).toBeNull();
  });

  it('finds a tag by name scoped to the project', async () => {
    const created = await createTag(db, { projectId, name: 'infra' });
    expect((await getTagByName(db, projectId, 'infra'))?.id).toBe(created.id);
    const other = (await createProject(db, { name: 'Other' })).id;
    expect(await getTagByName(db, other, 'infra')).toBeUndefined();
  });

  it('enforces unique tag names per project but allows reuse across projects', async () => {
    await createTag(db, { projectId, name: 'dup' });
    await expect(createTag(db, { projectId, name: 'dup' })).rejects.toThrow();
    const other = (await createProject(db, { name: 'Other' })).id;
    await expect(createTag(db, { projectId: other, name: 'dup' })).resolves.toBeTruthy();
  });

  it('lists tags for a project ordered by name', async () => {
    await createTag(db, { projectId, name: 'zeta' });
    await createTag(db, { projectId, name: 'alpha' });
    const other = (await createProject(db, { name: 'Other' })).id;
    await createTag(db, { projectId: other, name: 'elsewhere' });
    expect((await listTags(db, projectId)).map((tag) => tag.name)).toEqual(['alpha', 'zeta']);
  });

  it('updates a tag name and color', async () => {
    const created = await createTag(db, { projectId, name: 'before', color: null });
    const updated = await updateTag(db, created.id, { name: 'after', color: '#00ff00' });
    expect(updated?.name).toBe('after');
    expect(updated?.color).toBe('#00ff00');
  });

  it('rename propagates through the join table (single tag row)', async () => {
    const tag = await createTag(db, { projectId, name: 'old-name' });
    const task = await createTask(db, { projectId, label: 'Tagged' });
    await setTaskTags(db, task.id, [tag.id]);

    await updateTag(db, tag.id, { name: 'new-name' });

    expect((await listTagsForTask(db, task.id)).map((row) => row.name)).toEqual(['new-name']);
  });

  it('setTaskTags replaces the full set and deduplicates', async () => {
    const a = await createTag(db, { projectId, name: 'a' });
    const b = await createTag(db, { projectId, name: 'b' });
    const c = await createTag(db, { projectId, name: 'c' });
    const task = await createTask(db, { projectId, label: 'Tagged' });

    await setTaskTags(db, task.id, [a.id, b.id, b.id]);
    expect((await listTagsForTask(db, task.id)).map((row) => row.name)).toEqual(['a', 'b']);

    await setTaskTags(db, task.id, [c.id]);
    expect((await listTagsForTask(db, task.id)).map((row) => row.name)).toEqual(['c']);

    await setTaskTags(db, task.id, []);
    expect(await listTagsForTask(db, task.id)).toHaveLength(0);
  });

  it('deleteTag removes the tag from its tasks (cascade on the join)', async () => {
    const tag = await createTag(db, { projectId, name: 'doomed' });
    const keep = await createTag(db, { projectId, name: 'keep' });
    const task = await createTask(db, { projectId, label: 'Tagged' });
    await setTaskTags(db, task.id, [tag.id, keep.id]);

    expect(await deleteTag(db, tag.id)).toBe(true);

    expect(await getTag(db, tag.id)).toBeUndefined();
    expect((await listTagsForTask(db, task.id)).map((row) => row.name)).toEqual(['keep']);
    expect(await getTask(db, task.id)).toBeDefined();
    expect(await deleteTag(db, tag.id)).toBe(false);
  });

  it('deleteTagsByProjectId removes tags and their join rows', async () => {
    const a = await createTag(db, { projectId, name: 'a' });
    const task = await createTask(db, { projectId, label: 'Tagged' });
    await setTaskTags(db, task.id, [a.id]);

    expect(await deleteTagsByProjectId(db, projectId)).toBe(1);
    expect(await listTags(db, projectId)).toHaveLength(0);
    expect(await listTagsForTask(db, task.id)).toHaveLength(0);
  });

  it('deleteTaskTagsByTaskId clears associations so the task can be deleted', async () => {
    const tag = await createTag(db, { projectId, name: 'a' });
    const task = await createTask(db, { projectId, label: 'Tagged' });
    await setTaskTags(db, task.id, [tag.id]);

    expect(await deleteTaskTagsByTaskId(db, task.id)).toBe(1);
    expect(await deleteTask(db, task.id)).toBe(true);
    expect(await getTag(db, tag.id)).toBeDefined();
  });

  it('groups tags by task for a project', async () => {
    const a = await createTag(db, { projectId, name: 'a' });
    const b = await createTag(db, { projectId, name: 'b' });
    const t1 = await createTask(db, { projectId, label: 'One' });
    const t2 = await createTask(db, { projectId, label: 'Two' });
    const t3 = await createTask(db, { projectId, label: 'Untagged' });
    await setTaskTags(db, t1.id, [a.id, b.id]);
    await setTaskTags(db, t2.id, [b.id]);

    const byTask = await listTagsByTaskForProject(db, projectId);
    expect(byTask.get(t1.id)?.map((tag) => tag.name)).toEqual(['a', 'b']);
    expect(byTask.get(t2.id)?.map((tag) => tag.name)).toEqual(['b']);
    expect(byTask.get(t3.id)).toBeUndefined();
  });

  it('taskIdsWithAnyTagName uses OR semantics across the given names', async () => {
    const a = await createTag(db, { projectId, name: 'a' });
    const b = await createTag(db, { projectId, name: 'b' });
    const t1 = await createTask(db, { projectId, label: 'Has a' });
    const t2 = await createTask(db, { projectId, label: 'Has b' });
    const t3 = await createTask(db, { projectId, label: 'Has both' });
    await createTask(db, { projectId, label: 'Untagged' });
    await setTaskTags(db, t1.id, [a.id]);
    await setTaskTags(db, t2.id, [b.id]);
    await setTaskTags(db, t3.id, [a.id, b.id]);

    expect(await taskIdsWithAnyTagName(db, projectId, ['a'])).toEqual(new Set([t1.id, t3.id]));
    expect(await taskIdsWithAnyTagName(db, projectId, ['a', 'b'])).toEqual(
      new Set([t1.id, t2.id, t3.id]),
    );
    expect(await taskIdsWithAnyTagName(db, projectId, ['missing'])).toEqual(new Set());
    expect(await taskIdsWithAnyTagName(db, projectId, [])).toEqual(new Set());
  });

  it('scopes taskIdsWithAnyTagName to the project', async () => {
    const other = (await createProject(db, { name: 'Other' })).id;
    const otherTag = await createTag(db, { projectId: other, name: 'shared' });
    const otherTask = await createTask(db, { projectId: other, label: 'Elsewhere' });
    await setTaskTags(db, otherTask.id, [otherTag.id]);

    expect(await taskIdsWithAnyTagName(db, projectId, ['shared'])).toEqual(new Set());
  });
});
