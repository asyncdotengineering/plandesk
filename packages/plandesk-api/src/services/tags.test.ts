import { describe, expect, it } from 'vitest';
import { createDb, createProject, listTagsForTask, migrate } from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createTagService, InvalidTagError } from './tags.js';
import { createTaskService } from './tasks.js';

function setup() {
  const db = createDb(':memory:');
  migrate(db);
  const eventBus = createEventBus();
  const received: PlankDeskEvent[] = [];
  eventBus.subscribe((event) => {
    received.push(event);
  });
  const tagService = createTagService({ db, eventBus });
  const taskService = createTaskService({ db, eventBus });
  const project = createProject(db, { name: 'Tags' });
  return { db, eventBus, received, tagService, taskService, projectId: project.id };
}

describe('tag service', () => {
  it('creates, lists, updates, and deletes a tag with tag_updated events', () => {
    const { tagService, received, projectId } = setup();

    const created = tagService.create(projectId, { name: 'backend', color: '#2563eb' });
    expect(created?.name).toBe('backend');
    expect(created?.color).toBe('#2563eb');
    expect(created?.project_id).toBe(projectId);
    expect(received).toContainEqual({ type: 'tag_updated', projectId });

    const listed = tagService.list(projectId);
    expect(listed?.map((tag) => tag.name)).toEqual(['backend']);

    const updated = tagService.update(created?.id ?? '', { name: 'infra', color: null });
    expect(updated?.name).toBe('infra');
    expect(updated?.color).toBeNull();

    expect(tagService.delete(created?.id ?? '')).toBe(true);
    expect(tagService.list(projectId)).toHaveLength(0);
    expect(received.filter((event) => event.type === 'tag_updated')).toHaveLength(3);
  });

  it('trims names and rejects blank or duplicate names', () => {
    const { tagService, projectId } = setup();

    const created = tagService.create(projectId, { name: '  spaced  ' });
    expect(created?.name).toBe('spaced');

    expect(() => tagService.create(projectId, { name: '   ' })).toThrow(InvalidTagError);
    expect(() => tagService.create(projectId, { name: 'spaced' })).toThrow(InvalidTagError);

    const other = tagService.create(projectId, { name: 'other' });
    expect(() => tagService.update(other?.id ?? '', { name: 'spaced' })).toThrow(InvalidTagError);
    // Renaming a tag to its own name is a no-op, not a conflict.
    expect(tagService.update(other?.id ?? '', { name: 'other' })?.name).toBe('other');
  });

  it('returns undefined/false for unknown projects and tags', () => {
    const { tagService } = setup();
    const missing = '00000000-0000-4000-8000-000000009999';
    expect(tagService.list(missing)).toBeUndefined();
    expect(tagService.create(missing, { name: 'x' })).toBeUndefined();
    expect(tagService.update(missing, { name: 'x' })).toBeUndefined();
    expect(tagService.delete(missing)).toBe(false);
  });

  it('rename propagates to tasks referencing the tag', () => {
    const { db, tagService, taskService, projectId } = setup();

    const task = taskService.create(projectId, { label: 'Tagged', tags: ['old-name'] });
    const tag = tagService.list(projectId)?.[0];
    expect(tag?.name).toBe('old-name');

    tagService.update(tag?.id ?? '', { name: 'new-name' });

    const refetched = taskService.get(task?.id ?? '');
    expect(refetched?.tags?.map((row) => row.name)).toEqual(['new-name']);
    expect(listTagsForTask(db, task?.id ?? '').map((row) => row.name)).toEqual(['new-name']);
  });

  it('delete removes the tag from its tasks but keeps the tasks', () => {
    const { db, tagService, taskService, projectId } = setup();

    const task = taskService.create(projectId, { label: 'Tagged', tags: ['doomed', 'keep'] });
    const doomed = tagService.list(projectId)?.find((tag) => tag.name === 'doomed');

    expect(tagService.delete(doomed?.id ?? '')).toBe(true);

    const refetched = taskService.get(task?.id ?? '');
    expect(refetched?.tags?.map((row) => row.name)).toEqual(['keep']);
    expect(listTagsForTask(db, task?.id ?? '')).toHaveLength(1);
  });
});
