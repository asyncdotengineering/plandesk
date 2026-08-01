import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  getTask,
  migrate,
  type Db,
} from '@plandesk/db';
import { createServices } from '@plandesk/api';
import { createCreateTaskHandler } from './create-task.js';
import { createUpdateTaskHandler } from './update-task.js';
import { createClaimTaskHandler } from './claim-task.js';
import { createTaskInputSchema, updateTaskInputSchema } from './registry.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Gap closed by this task: create_task / update_task MCP schemas and handlers
 * previously omitted `assignee` even though the DB column, API, and web UI
 * already wrote it. claim_task was the only MCP writer.
 */
describe('MCP assignee wiring (closes create/update gap)', () => {
  let db: Db;
  let projectId = '';
  let orgId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Assignee MCP' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('create_task and update_task schemas accept assignee (the MCP gap)', () => {
    expect('assignee' in createTaskInputSchema.shape).toBe(true);
    expect('assignee' in updateTaskInputSchema.shape).toBe(true);
    expect(
      createTaskInputSchema.safeParse({
        project_id: PROJECT_ID,
        label: 'T',
        assignee: 'ada',
      }).success,
    ).toBe(true);
    expect(
      updateTaskInputSchema.safeParse({
        task_id: PROJECT_ID,
        assignee: null,
      }).success,
    ).toBe(true);
    expect(
      createTaskInputSchema.safeParse({
        project_id: PROJECT_ID,
        label: 'T',
        assignee: '',
      }).success,
    ).toBe(false);
  });

  it('create_task / update_task round-trip assignee; null clears; claim overwrites human', async () => {
    const services = createServices({ db, orgId });
    const create = createCreateTaskHandler(services.taskService);
    const update = createUpdateTaskHandler(services.taskService);
    const claim = createClaimTaskHandler(services.taskService);

    const createdResult = await create({
      project_id: projectId,
      label: 'Assigned',
      assignee: 'ada@example.com',
    });
    expect(createdResult.isError).not.toBe(true);
    const createdText =
      createdResult.content[0]?.type === 'text' ? createdResult.content[0].text : undefined;
    const created = (
      JSON.parse(createdText ?? '{}') as { task: { id: string; assignee: string | null } }
    ).task;
    expect(created.assignee).toBe('ada@example.com');
    expect((await getTask(db, created.id))?.assignee).toBe('ada@example.com');

    const clearedResult = await update({ task_id: created.id, assignee: null });
    expect(clearedResult.isError).not.toBe(true);
    expect((await getTask(db, created.id))?.assignee).toBeNull();

    await update({ task_id: created.id, assignee: 'bob@example.com', status: 'todo' });
    const claimed = await claim({ task_id: created.id, agent_ref: 'agent-42' });
    expect(claimed.isError).not.toBe(true);
    const claimedText =
      claimed.content[0]?.type === 'text' ? claimed.content[0].text : undefined;
    const claimPayload = JSON.parse(claimedText ?? '{}') as {
      claimed: boolean;
      task?: { assignee: string | null };
    };
    expect(claimPayload.claimed).toBe(true);
    expect(claimPayload.task?.assignee).toBe('agent-42');
    expect((await getTask(db, created.id))?.assignee).toBe('agent-42');
  });
});
