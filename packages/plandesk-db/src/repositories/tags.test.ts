import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createTask, deleteTask, getTask } from './tasks.js';
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
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM task_tags');
    db.$client.exec('DELETE FROM tags');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Tags' }).id;
  });

  it('creates and retrieves a tag', () => {
    const created = createTag(db, { projectId, name: 'backend', color: '#ff0000' });
    const fetched = getTag(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.name).toBe('backend');
    expect(fetched?.color).toBe('#ff0000');
  });

  it('defaults color to null', () => {
    const created = createTag(db, { projectId, name: 'plain' });
    expect(created.color).toBeNull();
  });

  it('finds a tag by name scoped to the project', () => {
    const created = createTag(db, { projectId, name: 'infra' });
    expect(getTagByName(db, projectId, 'infra')?.id).toBe(created.id);
    const other = createProject(db, { name: 'Other' }).id;
    expect(getTagByName(db, other, 'infra')).toBeUndefined();
  });

  it('enforces unique tag names per project but allows reuse across projects', () => {
    createTag(db, { projectId, name: 'dup' });
    expect(() => createTag(db, { projectId, name: 'dup' })).toThrow();
    const other = createProject(db, { name: 'Other' }).id;
    expect(() => createTag(db, { projectId: other, name: 'dup' })).not.toThrow();
  });

  it('lists tags for a project ordered by name', () => {
    createTag(db, { projectId, name: 'zeta' });
    createTag(db, { projectId, name: 'alpha' });
    const other = createProject(db, { name: 'Other' }).id;
    createTag(db, { projectId: other, name: 'elsewhere' });
    expect(listTags(db, projectId).map((tag) => tag.name)).toEqual(['alpha', 'zeta']);
  });

  it('updates a tag name and color', () => {
    const created = createTag(db, { projectId, name: 'before', color: null });
    const updated = updateTag(db, created.id, { name: 'after', color: '#00ff00' });
    expect(updated?.name).toBe('after');
    expect(updated?.color).toBe('#00ff00');
  });

  it('rename propagates through the join table (single tag row)', () => {
    const tag = createTag(db, { projectId, name: 'old-name' });
    const task = createTask(db, { projectId, label: 'Tagged' });
    setTaskTags(db, task.id, [tag.id]);

    updateTag(db, tag.id, { name: 'new-name' });

    expect(listTagsForTask(db, task.id).map((row) => row.name)).toEqual(['new-name']);
  });

  it('setTaskTags replaces the full set and deduplicates', () => {
    const a = createTag(db, { projectId, name: 'a' });
    const b = createTag(db, { projectId, name: 'b' });
    const c = createTag(db, { projectId, name: 'c' });
    const task = createTask(db, { projectId, label: 'Tagged' });

    setTaskTags(db, task.id, [a.id, b.id, b.id]);
    expect(listTagsForTask(db, task.id).map((row) => row.name)).toEqual(['a', 'b']);

    setTaskTags(db, task.id, [c.id]);
    expect(listTagsForTask(db, task.id).map((row) => row.name)).toEqual(['c']);

    setTaskTags(db, task.id, []);
    expect(listTagsForTask(db, task.id)).toHaveLength(0);
  });

  it('deleteTag removes the tag from its tasks (cascade on the join)', () => {
    const tag = createTag(db, { projectId, name: 'doomed' });
    const keep = createTag(db, { projectId, name: 'keep' });
    const task = createTask(db, { projectId, label: 'Tagged' });
    setTaskTags(db, task.id, [tag.id, keep.id]);

    expect(deleteTag(db, tag.id)).toBe(true);

    expect(getTag(db, tag.id)).toBeUndefined();
    expect(listTagsForTask(db, task.id).map((row) => row.name)).toEqual(['keep']);
    expect(getTask(db, task.id)).toBeDefined();
    expect(deleteTag(db, tag.id)).toBe(false);
  });

  it('deleteTagsByProjectId removes tags and their join rows', () => {
    const a = createTag(db, { projectId, name: 'a' });
    const task = createTask(db, { projectId, label: 'Tagged' });
    setTaskTags(db, task.id, [a.id]);

    expect(deleteTagsByProjectId(db, projectId)).toBe(1);
    expect(listTags(db, projectId)).toHaveLength(0);
    expect(listTagsForTask(db, task.id)).toHaveLength(0);
  });

  it('deleteTaskTagsByTaskId clears associations so the task can be deleted', () => {
    const tag = createTag(db, { projectId, name: 'a' });
    const task = createTask(db, { projectId, label: 'Tagged' });
    setTaskTags(db, task.id, [tag.id]);

    expect(deleteTaskTagsByTaskId(db, task.id)).toBe(1);
    expect(deleteTask(db, task.id)).toBe(true);
    expect(getTag(db, tag.id)).toBeDefined();
  });

  it('groups tags by task for a project', () => {
    const a = createTag(db, { projectId, name: 'a' });
    const b = createTag(db, { projectId, name: 'b' });
    const t1 = createTask(db, { projectId, label: 'One' });
    const t2 = createTask(db, { projectId, label: 'Two' });
    const t3 = createTask(db, { projectId, label: 'Untagged' });
    setTaskTags(db, t1.id, [a.id, b.id]);
    setTaskTags(db, t2.id, [b.id]);

    const byTask = listTagsByTaskForProject(db, projectId);
    expect(byTask.get(t1.id)?.map((tag) => tag.name)).toEqual(['a', 'b']);
    expect(byTask.get(t2.id)?.map((tag) => tag.name)).toEqual(['b']);
    expect(byTask.get(t3.id)).toBeUndefined();
  });

  it('taskIdsWithAnyTagName uses OR semantics across the given names', () => {
    const a = createTag(db, { projectId, name: 'a' });
    const b = createTag(db, { projectId, name: 'b' });
    const t1 = createTask(db, { projectId, label: 'Has a' });
    const t2 = createTask(db, { projectId, label: 'Has b' });
    const t3 = createTask(db, { projectId, label: 'Has both' });
    createTask(db, { projectId, label: 'Untagged' });
    setTaskTags(db, t1.id, [a.id]);
    setTaskTags(db, t2.id, [b.id]);
    setTaskTags(db, t3.id, [a.id, b.id]);

    expect(taskIdsWithAnyTagName(db, projectId, ['a'])).toEqual(new Set([t1.id, t3.id]));
    expect(taskIdsWithAnyTagName(db, projectId, ['a', 'b'])).toEqual(
      new Set([t1.id, t2.id, t3.id]),
    );
    expect(taskIdsWithAnyTagName(db, projectId, ['missing'])).toEqual(new Set());
    expect(taskIdsWithAnyTagName(db, projectId, [])).toEqual(new Set());
  });

  it('scopes taskIdsWithAnyTagName to the project', () => {
    const other = createProject(db, { name: 'Other' }).id;
    const otherTag = createTag(db, { projectId: other, name: 'shared' });
    const otherTask = createTask(db, { projectId: other, label: 'Elsewhere' });
    setTaskTags(db, otherTask.id, [otherTag.id]);

    expect(taskIdsWithAnyTagName(db, projectId, ['shared'])).toEqual(new Set());
  });
});
