import { describe, expect, it } from 'vitest';
import {
  createTaskInputSchema,
  getNextTaskInputSchema,
  listTagsInputSchema,
  listTasksInputSchema,
  updateTaskInputSchema,
  v1ToolNames,
  v1ToolSchemas,
} from './registry.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const TASK_ID = '00000000-0000-4000-8000-000000000002';

describe('tool registry tag schemas', () => {
  it('registers list_tags with a schema for every v1 tool', () => {
    expect(v1ToolNames).toContain('list_tags');
    expect(v1ToolNames).toHaveLength(30);
    for (const name of v1ToolNames) {
      expect(v1ToolSchemas[name]).toBeDefined();
    }
  });

  it('create_task accepts an optional tags string array', () => {
    expect(createTaskInputSchema.safeParse({ project_id: PROJECT_ID, label: 'T' }).success).toBe(
      true,
    );
    expect(
      createTaskInputSchema.safeParse({
        project_id: PROJECT_ID,
        label: 'T',
        tags: ['backend', 'urgent'],
      }).success,
    ).toBe(true);
    expect(
      createTaskInputSchema.safeParse({ project_id: PROJECT_ID, label: 'T', tags: 'backend' })
        .success,
    ).toBe(false);
    expect(
      createTaskInputSchema.safeParse({ project_id: PROJECT_ID, label: 'T', tags: [''] }).success,
    ).toBe(false);
  });

  it('update_task accepts tags including [] to clear the set', () => {
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, tags: [] }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, tags: ['a'] }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, tags: [1] }).success).toBe(false);
  });

  it('list_tasks and get_next_task accept an optional tags filter', () => {
    expect(listTasksInputSchema.safeParse({ project_id: PROJECT_ID }).success).toBe(true);
    expect(
      listTasksInputSchema.safeParse({ project_id: PROJECT_ID, tags: ['a', 'b'] }).success,
    ).toBe(true);
    expect(listTasksInputSchema.safeParse({ project_id: PROJECT_ID, tags: {} }).success).toBe(
      false,
    );
    expect(getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID }).success).toBe(true);
    expect(getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID, tags: ['a'] }).success).toBe(
      true,
    );
  });

  it('list_tags requires a project id', () => {
    expect(listTagsInputSchema.safeParse({ project_id: PROJECT_ID }).success).toBe(true);
    expect(listTagsInputSchema.safeParse({}).success).toBe(false);
  });

  it('documents replace-set and OR-filter semantics in the tag field descriptions', () => {
    expect(createTaskInputSchema.shape.tags.description).toMatch(/auto-created/i);
    expect(updateTaskInputSchema.shape.tags.description).toMatch(/replaces the full tag set/i);
    expect(listTasksInputSchema.shape.tags.description).toMatch(/OR semantics/i);
    expect(getNextTaskInputSchema.shape.tags.description).toMatch(/OR semantics/i);
  });
});
