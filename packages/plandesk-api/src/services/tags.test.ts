import { describe, expect, it } from 'vitest';
import { createDb, createProject, listTagsForTask, migrate, type Db } from '@plandesk/db';
import { createEventBus, type PlankDeskEvent } from '../events.js';
import { createTagService, InvalidTagError } from './tags.js';
import { createTaskService } from './tasks.js';

async function setup() {
  const db = await createDb(':memory:');
  await migrate(db);
  const eventBus = createEventBus();
  const received: PlankDeskEvent[] = [];
  eventBus.subscribe((event) => {
    received.push(event);
  });
  const tagService = createTagService({ db, eventBus });
  const taskService = createTaskService({ db, eventBus });
  const project = await createProject(db, { name: 'Tags' });
  return { db, eventBus, received, tagService, taskService, projectId: project.id };
}

describe('tag service', () => {
  it('creates, lists, updates, and deletes a tag with tag_updated events', async () => {
    const { tagService, received, projectId } = await setup();

    const created = await tagService.create(projectId, { name: 'backend', color: '#2563eb' });
    expect(created?.name).toBe('backend');
    expect(created?.color).toBe('#2563eb');
    expect(created?.project_id).toBe(projectId);
    expect(received).toContainEqual({ type: 'tag_updated', projectId });

    const listed = await tagService.list(projectId);
    expect(listed?.map((tag) => tag.name)).toEqual(['backend']);

    const updated = await tagService.update(created?.id ?? '', { name: 'infra', color: null });
    expect(updated?.name).toBe('infra');
    expect(updated?.color).toBeNull();
    expect(received.filter((e) => e.type === 'tag_updated')).toHaveLength(2);

    const deleted = await tagService.delete(created?.id ?? '');
    expect(deleted).toBe(true);
    expect(await tagService.list(projectId)).toEqual([]);
    expect(received.filter((e) => e.type === 'tag_updated')).toHaveLength(3);
  });

  it('rejects empty and duplicate names', async () => {
    const { tagService, projectId } = await setup();
    await expect(tagService.create(projectId, { name: '   ' })).rejects.toBeInstanceOf(
      InvalidTagError,
    );
    await tagService.create(projectId, { name: 'dup' });
    await expect(tagService.create(projectId, { name: 'dup' })).rejects.toBeInstanceOf(
      InvalidTagError,
    );
  });

  it('normalizes tag names by trimming', async () => {
    const { tagService, projectId } = await setup();
    const created = await tagService.create(projectId, { name: '  spaced  ' });
    expect(created?.name).toBe('spaced');
  });

  it('returns undefined for missing project or tag', async () => {
    const { tagService } = await setup();
    expect(await tagService.list('missing')).toBeUndefined();
    expect(await tagService.create('missing', { name: 'x' })).toBeUndefined();
    expect(await tagService.update('missing', { name: 'x' })).toBeUndefined();
    expect(await tagService.delete('missing')).toBe(false);
  });

  it('task create/update can set tags by name and auto-creates missing tags', async () => {
    const { db, taskService, projectId } = await setup();
    const task = await taskService.create(projectId, {
      label: 'T1',
      tags: ['alpha', 'beta'],
    });
    expect(task?.tags?.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
    const fromDb = await listTagsForTask(db, task!.id);
    expect(fromDb.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);

    const updated = await taskService.update(task!.id, { tags: ['beta', 'gamma'] });
    expect(updated?.tags?.map((t) => t.name).sort()).toEqual(['beta', 'gamma']);
  });
});
