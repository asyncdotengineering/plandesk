import { describe, expect, it } from 'vitest';
import {
  addCommentInputSchema,
  createGoalInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  getNextTaskInputSchema,
  getGoalInputSchema,
  listDocumentsInputSchema,
  listNotesInputSchema,
  getRevisionInputSchema,
  listCommentsInputSchema,
  listRevisionsInputSchema,
  listTagsInputSchema,
  listViewsInputSchema,
  listTasksInputSchema,
  scaffoldProjectFromPlanInputSchema,
  triageSubmissionInputSchema,
  updateProjectInputSchema,
  updateGoalInputSchema,
  updateTaskInputSchema,
  v1ToolNames,
  v1ToolSchemas,
} from './registry.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const TASK_ID = '00000000-0000-4000-8000-000000000002';

describe('tool registry tag schemas', () => {
  it('registers list_tags with a schema for every v1 tool', () => {
    expect(v1ToolNames).toContain('list_tags');
    expect(v1ToolNames).toContain('list_views');
    expect(v1ToolNames).toContain('list_revisions');
    expect(v1ToolNames).toContain('get_revision');
    expect(v1ToolNames).toContain('claim_task');
    expect(v1ToolNames).toContain('get_task_graph');
    expect(v1ToolNames).toContain('update_project');
    expect(v1ToolNames).toContain('create_prototype');
    expect(v1ToolNames).toContain('list_prototypes');
    expect(v1ToolNames).toContain('get_prototype');
    expect(v1ToolNames).toContain('update_prototype');
    expect(v1ToolNames).toContain('move_screen');
    expect(v1ToolNames).toContain('copy_screen');
    expect(v1ToolNames).toHaveLength(64);
    for (const name of v1ToolNames) {
      expect(v1ToolSchemas[name]).toBeDefined();
    }
  });

  it('REVERT-PROOF: MCP surface has no mutating or restore revision tools', () => {
    const names: readonly string[] = v1ToolNames;
    expect(names).toContain('list_revisions');
    expect(names).toContain('get_revision');
    expect(names).not.toContain('restore_revision');
    const revisionTools = names.filter((name) => name.includes('revision'));
    expect(revisionTools).toEqual(['list_revisions', 'get_revision']);
    const mutatingRevisionTools = names.filter((name) =>
      /^(create|update|delete|restore)_revisions?$/.test(name),
    );
    expect(mutatingRevisionTools).toEqual([]);
  });

  it('list_revisions and get_revision schemas require the stated ids', () => {
    const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
    const TARGET_ID = '00000000-0000-4000-8000-000000000002';
    const REVISION_ID = '00000000-0000-4000-8000-000000000003';
    expect(
      listRevisionsInputSchema.safeParse({
        project_id: PROJECT_ID,
        target_type: 'task',
        target_id: TARGET_ID,
      }).success,
    ).toBe(true);
    expect(
      listRevisionsInputSchema.safeParse({
        project_id: PROJECT_ID,
        target_type: 'document',
        target_id: TARGET_ID,
      }).success,
    ).toBe(true);
    expect(
      listRevisionsInputSchema.safeParse({
        project_id: PROJECT_ID,
        target_type: 'note',
        target_id: TARGET_ID,
      }).success,
    ).toBe(false);
    expect(getRevisionInputSchema.safeParse({ revision_id: REVISION_ID }).success).toBe(true);
    expect(getRevisionInputSchema.safeParse({}).success).toBe(false);
  });

  it('create_project and update_project accept repo_url and folder_path; reject dangerous schemes and absolute paths', () => {
    expect(
      createProjectInputSchema.safeParse({
        name: 'P',
        repo_url: 'https://github.com/acme/plandesk',
        folder_path: 'packages/api',
      }).success,
    ).toBe(true);
    expect(createProjectInputSchema.safeParse({ name: 'P', repo_url: null }).success).toBe(true);
    expect(createProjectInputSchema.safeParse({ name: 'P', repo_url: 'not-a-url' }).success).toBe(
      false,
    );
    expect(
      createProjectInputSchema.safeParse({ name: 'P', repo_url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ name: 'P', repo_url: 'data:text/html,x' }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ name: 'P', repo_url: 'file:///tmp/x' }).success,
    ).toBe(false);
    expect(createProjectInputSchema.safeParse({ name: 'P', folder_path: '/etc' }).success).toBe(
      false,
    );
    expect(
      createProjectInputSchema.safeParse({ name: 'P', folder_path: '../../other' }).success,
    ).toBe(false);
    expect(
      updateProjectInputSchema.safeParse({
        project_id: PROJECT_ID,
        repo_url: null,
        folder_path: null,
      }).success,
    ).toBe(true);
    expect(
      updateProjectInputSchema.safeParse({
        project_id: PROJECT_ID,
        repo_url: 'git@github.com:acme/plandesk.git',
      }).success,
    ).toBe(true);
  });

  it('create_project and update_project reject scp-smuggled schemes and drive-relative paths', () => {
    expect(
      createProjectInputSchema.safeParse({
        name: 'P',
        repo_url: 'javascript:alert@github.com:org/repo.git',
      }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({
        name: 'P',
        repo_url: 'data:text,owned@github.com:org/repo.git',
      }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({
        name: 'P',
        repo_url: 'file:C:@github.com:org/repo.git',
      }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ name: 'P', folder_path: 'C:..\\secret' }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ name: 'P', folder_path: 'C:relative\\path' }).success,
    ).toBe(false);
    expect(createProjectInputSchema.safeParse({ name: 'P', folder_path: 'C:\\abs' }).success).toBe(
      false,
    );
    expect(createProjectInputSchema.safeParse({ name: 'P', folder_path: 'c:..' }).success).toBe(
      false,
    );
    expect(
      createProjectInputSchema.safeParse({ name: 'P', folder_path: 'packages/plandesk-api' })
        .success,
    ).toBe(true);
    expect(
      createProjectInputSchema.safeParse({
        name: 'P',
        repo_url: 'git@github.com:org/repo.git',
      }).success,
    ).toBe(true);
    expect(
      updateProjectInputSchema.safeParse({
        project_id: PROJECT_ID,
        repo_url: 'javascript:alert@github.com:org/repo.git',
      }).success,
    ).toBe(false);
    expect(
      updateProjectInputSchema.safeParse({
        project_id: PROJECT_ID,
        folder_path: 'C:..\\secret',
      }).success,
    ).toBe(false);
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

  it('accepts only the typed lane and severity vocabularies', () => {
    expect(
      createTaskInputSchema.safeParse({ project_id: PROJECT_ID, label: 'T', lane: 'auto', severity: 'high' })
        .success,
    ).toBe(true);
    expect(
      createTaskInputSchema.safeParse({ project_id: PROJECT_ID, label: 'T', lane: 'manual' }).success,
    ).toBe(false);
    expect(
      updateTaskInputSchema.safeParse({ task_id: TASK_ID, severity: 'critical' }).success,
    ).toBe(false);
    expect(
      listTasksInputSchema.safeParse({ project_id: PROJECT_ID, lane: 'approve', severity: 'low' })
        .success,
    ).toBe(true);
  });

  it('accepts optional goal names and project-scoped next-task goal references', () => {
    expect(
      createGoalInputSchema.safeParse({
        project_id: PROJECT_ID,
        name: 'orpc-rewrite',
        objective: 'Rewrite the RPC layer',
      }).success,
    ).toBe(true);
    expect(updateGoalInputSchema.safeParse({ goal_id: TASK_ID, name: 'renamed' }).success).toBe(
      true,
    );
    expect(
      getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID, goal: 'orpc-rewrite' }).success,
    ).toBe(true);
  });

  it('uses one verbose projection control across MCP read tools', () => {
    expect(listTasksInputSchema.safeParse({ project_id: PROJECT_ID, verbose: true }).success).toBe(
      true,
    );
    expect(
      listDocumentsInputSchema.safeParse({ project_id: PROJECT_ID, verbose: true }).success,
    ).toBe(true);
    expect(listNotesInputSchema.safeParse({ project_id: PROJECT_ID, verbose: true }).success).toBe(
      true,
    );
    expect(getGoalInputSchema.safeParse({ goal_id: TASK_ID, verbose: true }).success).toBe(true);
    expect(getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID, verbose: true }).success).toBe(
      true,
    );
  });

  it('update_task accepts tags including [] to clear the set', () => {
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, tags: [] }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, tags: ['a'] }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, tags: [1] }).success).toBe(false);
  });

  it('update_task accepts commit_refs as hex SHAs (case-insensitive, max 50); create_task does not', () => {
    expect(
      updateTaskInputSchema.safeParse({
        task_id: TASK_ID,
        commit_refs: ['abc1234', 'deadbeefcafebabe'],
      }).success,
    ).toBe(true);
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, commit_refs: null }).success).toBe(
      true,
    );
    expect(
      updateTaskInputSchema.safeParse({ task_id: TASK_ID, commit_refs: ['ABC1234'] }).success,
    ).toBe(true);
    expect(
      updateTaskInputSchema.safeParse({ task_id: TASK_ID, commit_refs: ['abc12'] }).success,
    ).toBe(false);
    const fifty = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(7, '0'));
    expect(updateTaskInputSchema.safeParse({ task_id: TASK_ID, commit_refs: fifty }).success).toBe(
      true,
    );
    expect(
      updateTaskInputSchema.safeParse({
        task_id: TASK_ID,
        commit_refs: [...fifty, 'aaaaaaa'],
      }).success,
    ).toBe(false);
    expect('commit_refs' in createTaskInputSchema.shape).toBe(false);
  });

  it('get_next_task accepts an optional goal_id filter', () => {
    const GOAL_ID = '00000000-0000-4000-8000-000000000003';
    expect(getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID }).success).toBe(true);
    expect(
      getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID, goal_id: GOAL_ID }).success,
    ).toBe(true);
    expect(
      getNextTaskInputSchema.safeParse({ project_id: PROJECT_ID, goal_id: 'not-a-uuid' }).success,
    ).toBe(false);
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

  it('list_views requires a project id', () => {
    expect(listViewsInputSchema.safeParse({ project_id: PROJECT_ID }).success).toBe(true);
    expect(listViewsInputSchema.safeParse({}).success).toBe(false);
  });

  it('MCP surface has list_views and no create/update/delete view tools', () => {
    expect(v1ToolNames).toContain('list_views');
    const names: readonly string[] = v1ToolNames;
    const mutatingViewTools = names.filter((name) => /^(create|update|delete)_views?$/.test(name));
    expect(mutatingViewTools).toEqual([]);
  });

  it('triage_submission accepts an optional link_task_id alongside as_task', () => {
    expect(
      triageSubmissionInputSchema.safeParse({
        submission_id: '00000000-0000-4000-8000-000000000003',
        action: 'accept',
        link_task_id: TASK_ID,
      }).success,
    ).toBe(true);
    expect(
      triageSubmissionInputSchema.safeParse({
        submission_id: '00000000-0000-4000-8000-000000000003',
        action: 'accept',
        link_task_id: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('documents replace-set and OR-filter semantics in the tag field descriptions', () => {
    expect(createTaskInputSchema.shape.tags.description).toMatch(/auto-created/i);
    expect(updateTaskInputSchema.shape.tags.description).toMatch(/replaces the full tag set/i);
    expect(listTasksInputSchema.shape.tags.description).toMatch(/OR semantics/i);
    expect(getNextTaskInputSchema.shape.tags.description).toMatch(/OR semantics/i);
  });

  it('documents build-contract depth in the task description field guidance', () => {
    expect(createTaskInputSchema.shape.description.description).toMatch(/interfaces/i);
    expect(createTaskInputSchema.shape.description.description).toMatch(/pseudocode/i);
    expect(createTaskInputSchema.shape.description.description).toMatch(/validation contract/i);
    expect(updateTaskInputSchema.shape.description.description).toMatch(/interfaces/i);
    expect(
      scaffoldProjectFromPlanInputSchema.shape.tasks.element.shape.description.description,
    ).toMatch(/interfaces/i);
  });

  it('add_comment requires target_type and target_id', () => {
    const DOC_ID = '00000000-0000-4000-8000-000000000004';
    expect(
      addCommentInputSchema.safeParse({
        target_type: 'document',
        target_id: DOC_ID,
        body: 'Note',
      }).success,
    ).toBe(true);
    expect(
      addCommentInputSchema.safeParse({ target_type: 'task', target_id: DOC_ID, body: 'Note' })
        .success,
    ).toBe(true);
    expect(
      addCommentInputSchema.safeParse({
        target_type: 'submission',
        target_id: DOC_ID,
        body: 'Note',
      }).success,
    ).toBe(true);
    expect(addCommentInputSchema.safeParse({ document_id: DOC_ID, body: 'Note' }).success).toBe(
      false,
    );
  });

  it('list_comments accepts optional target_type and target_id', () => {
    const DOC_ID = '00000000-0000-4000-8000-000000000004';
    expect(listCommentsInputSchema.safeParse({ project_id: PROJECT_ID }).success).toBe(true);
    expect(
      listCommentsInputSchema.safeParse({
        project_id: PROJECT_ID,
        target_type: 'note',
        target_id: DOC_ID,
      }).success,
    ).toBe(true);
    expect(
      listCommentsInputSchema.safeParse({ project_id: PROJECT_ID, target_id: DOC_ID }).success,
    ).toBe(true);
  });
});
