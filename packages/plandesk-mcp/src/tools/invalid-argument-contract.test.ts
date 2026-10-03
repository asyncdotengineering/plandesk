import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDb, createProjectInDefaultOrg as createProject, migrate } from '@plandesk/db';
import { createServices, localOwner, type Services } from '@plandesk/api';
import { toolHandler } from '../../../plandesk-api/test-support/mcp-tool-handlers.js';

/**
 * Contract: a service validation error reaches an MCP caller as exactly
 * `{ content: [{ type: 'text', text: '{"error":"invalid_argument","message":…}' }], isError: true }`
 * through the handler the server registers, whichever tool raised it.
 */
function invalid(message: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_argument', message }) }],
    isError: true,
  };
}

async function call(services: Services, name: string, args: Record<string, unknown>) {
  return toolHandler(name, services)(args);
}

/** Run a tool that must succeed and return the id of the entity under `key`. */
async function idOf(
  services: Services,
  name: string,
  key: string,
  args: Record<string, unknown>,
): Promise<string> {
  const text = (await call(services, name, args)).content[0]?.text ?? '{}';
  const id = (JSON.parse(text) as Record<string, { id?: string } | undefined>)[key]?.id;
  if (id === undefined) {
    throw new Error(`${name} failed: ${text}`);
  }
  return id;
}

async function setup() {
  const db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, { name: 'Contract' });
  const other = await createProject(db, { name: 'Other' });
  const services = createServices({ db, principal: localOwner(project.orgId) });
  return { services, p: project.id, other: other.id };
}

describe('service validation errors → MCP invalid_argument', () => {
  it('maps every service validation family to the same tool result', async () => {
    const { services, p, other } = await setup();
    const task = await idOf(services, 'create_task', 'task', { project_id: p, label: 'T' });
    const otherTask = await idOf(services, 'create_task', 'task', {
      project_id: other,
      label: 'O',
    });
    const otherDoc = await idOf(services, 'create_document', 'document', {
      project_id: other,
      title: 'O',
    });
    const folder = await idOf(services, 'create_folder', 'folder', { project_id: p, name: 'F' });
    const note = await idOf(services, 'create_note', 'note', { project_id: p, title: 'N' });
    const run = await idOf(services, 'start_agent_run', 'agent_run', { project_id: p });
    await idOf(services, 'complete_agent_run', 'agent_run', { run_id: run, status: 'completed' });
    const goal = await idOf(services, 'create_goal', 'goal', {
      project_id: p,
      objective: 'G',
      name: 'g1',
    });
    await idOf(services, 'pause_goal', 'goal', { goal_id: goal });
    const goalId = randomUUID();

    const actual = {
      create_folder: await call(services, 'create_folder', {
        project_id: p,
        name: 'X',
        parent_folder_id: randomUUID(),
      }),
      update_folder: await call(services, 'update_folder', {
        folder_id: folder,
        parent_folder_id: folder,
      }),
      delete_folder: await call(services, 'delete_folder', {
        folder_id: folder,
        reparent_to: folder,
      }),
      create_note: await call(services, 'create_note', { project_id: p, title: '  ' }),
      update_note: await call(services, 'update_note', { note_id: note, title: '  ' }),
      complete_agent_run: await call(services, 'complete_agent_run', {
        run_id: run,
        status: 'completed',
      }),
      record_agent_progress: await call(services, 'record_agent_progress', {
        run_id: run,
        message: 'late',
      }),
      set_current_goal: await call(services, 'set_current_goal', { goal_id: goal }),
      pause_goal: await call(services, 'pause_goal', { goal_id: goal }),
      create_goal: await call(services, 'create_goal', {
        project_id: p,
        objective: 'again',
        name: 'g1',
      }),
      update_goal: await call(services, 'update_goal', {
        goal_id: goal,
        verification_surface: '{',
      }),
      list_revisions: await call(services, 'list_revisions', {
        project_id: p,
        target_type: 'bogus',
        target_id: task,
      }),
      add_comment: await call(services, 'add_comment', {
        target_type: 'task',
        target_id: task,
        body: '   ',
      }),
      create_edge: await call(services, 'create_edge', {
        project_id: p,
        from_type: 'task',
        from_id: task,
        to_type: 'task',
        to_id: otherTask,
      }),
      create_task: await call(services, 'create_task', {
        project_id: p,
        label: 'G',
        goal_id: goalId,
      }),
      update_task: await call(services, 'update_task', { task_id: task, verified_ref: 'abc' }),
      create_prototype: await call(services, 'create_prototype', {
        project_id: p,
        name: 'P',
        viewport_width: -1,
        viewport_height: 10,
      }),
      create_document: await call(services, 'create_document', {
        project_id: p,
        title: 'D',
        parent_id: otherDoc,
      }),
      create_artifact: await call(services, 'create_artifact', {
        project_id: p,
        title: 'A',
        kind: 'html',
        content: '<p>x</p>',
        prototype_id: randomUUID(),
      }),
    };

    expect(actual).toStrictEqual({
      create_folder: invalid('Parent folder does not belong to project'),
      update_folder: invalid('Folder cannot be its own parent'),
      delete_folder: invalid('Cannot reparent contents into the folder being deleted'),
      create_note: invalid('Note title must not be empty'),
      update_note: invalid('Note title must not be empty'),
      complete_agent_run: invalid('Agent run is already complete'),
      record_agent_progress: invalid('Agent run is already complete'),
      set_current_goal: invalid('Only an active goal can be set as current'),
      pause_goal: invalid('Goal can only be paused from active status'),
      create_goal: invalid('Goal name already exists in this project: g1'),
      update_goal: invalid('verification_surface must be valid JSON'),
      list_revisions: invalid('target_type must be task, document, or artifact'),
      add_comment: invalid('Comment body must not be empty'),
      create_edge: invalid('Edge to task not found in project'),
      create_task: invalid(`Goal ${goalId} does not exist in this project`),
      update_task: invalid('verified_at is required when setting verified_ref'),
      create_prototype: invalid('Viewport width and height must be finite positive numbers'),
      create_document: invalid('Parent document does not belong to project'),
      create_artifact: invalid(
        'prototype_id does not belong to this project (unknown or cross-project)',
      ),
    });
  });

  it('keeps the checklist-evidence payload, which carries no message', async () => {
    const { services, p } = await setup();
    const goal = await idOf(services, 'create_goal', 'goal', {
      project_id: p,
      objective: 'Checklist',
      verification_surface: JSON.stringify({
        kind: 'acceptance_checklist',
        items: [{ criterion: 'works' }],
      }),
    });
    const payload = { error: 'invalid_argument', unmatched: ['nope'], unmet: ['works'] };
    expect(
      await call(services, 'complete_goal', {
        goal_id: goal,
        evidence: { kind: 'acceptance_checklist', checked: ['nope'] },
      }),
    ).toStrictEqual({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    });
  });
});
