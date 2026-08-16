import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createServices } from '@plandesk/api';
import { createDb, createProject, insertRevision, migrate } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createGetRevisionHandler } from './get-revision.js';
import { createListRevisionsHandler } from './list-revisions.js';

const ORG_A = '00000000-0000-4000-8000-00000000aaaa';
const ORG_B = '00000000-0000-4000-8000-00000000bbbb';
const WS_A = '00000000-0000-4000-8000-00000000aaaw';
const WS_B = '00000000-0000-4000-8000-00000000bbbw';

function parsePayload(result: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = result.content[0]?.type === 'text' ? (result.content[0].text ?? '{}') : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP revision tools', () => {
  it('REVERT-PROOF: denies cross-org list_revisions and get_revision like unknown ids', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const projectA = await createProject(db, {
      name: 'Org A',
      orgId: ORG_A,
      workspaceId: WS_A,
    });
    await createProject(db, {
      name: 'Org B',
      orgId: ORG_B,
      workspaceId: WS_B,
    });
    const taskA = await createTask(db, {
      projectId: projectA.id,
      label: 'Secret',
      description: 'v0',
    });
    const revision = await insertRevision(db, {
      projectId: projectA.id,
      targetType: 'task',
      targetId: taskA.id,
      snapshot: JSON.stringify({ label: 'Secret', description: 'v0' }),
      changedFields: JSON.stringify(['description']),
      author: 'human:user-a',
    });

    const servicesB = createServices({ db, orgId: ORG_B });
    const list = createListRevisionsHandler(servicesB.revisionService);
    const get = createGetRevisionHandler(servicesB.revisionService);

    const listed = await list({
      project_id: projectA.id,
      target_type: 'task',
      target_id: taskA.id,
    });
    expect(listed.isError).toBe(true);
    expect(parsePayload(listed)).toEqual({ error: 'not_found' });

    const fetched = await get({ revision_id: revision.id });
    expect(fetched.isError).toBe(true);
    expect(parsePayload(fetched)).toEqual({ error: 'not_found' });

    // Same failures as genuinely unknown ids — no weaker downgrade.
    const unknownList = await list({
      project_id: randomUUID(),
      target_type: 'task',
      target_id: randomUUID(),
    });
    expect(unknownList.isError).toBe(true);
    expect(parsePayload(unknownList)).toEqual({ error: 'not_found' });

    const unknownGet = await get({ revision_id: randomUUID() });
    expect(unknownGet.isError).toBe(true);
    expect(parsePayload(unknownGet)).toEqual({ error: 'not_found' });
  });
});
