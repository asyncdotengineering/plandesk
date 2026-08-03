import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import { createTestApp, parseJson } from '../test-helpers.js';

type SearchPayload = {
  documents: Array<{ id: string; project_id: string; title: string }>;
  tasks: Array<{ id: string; project_id: string; label: string }>;
  notes: Array<{ id: string; project_id: string; title: string }>;
};

describe('GET /api/v1/search', () => {
  it('returns title matches within the scoped workspace only', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Alpha', workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Beta', workspaceId: wsB });
    await createTask(db, { projectId: projectA.id, label: 'Alpha launch checklist' });
    await createTask(db, { projectId: projectB.id, label: 'Alpha secret task' });

    const scoped = await app.request('/api/v1/search?q=alpha', {
      headers: { 'x-plandesk-workspace-id': wsA },
    });
    expect(scoped.status).toBe(200);
    const body = await parseJson<SearchPayload>(scoped);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.project_id).toBe(projectA.id);
    expect(body.tasks[0]?.label).toContain('Alpha');
  });

  it('returns empty arrays when nothing matches', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const projectA = await createProject(db, { name: 'Alpha', workspaceId: wsA });
    await createTask(db, { projectId: projectA.id, label: 'Ship it' });

    const res = await app.request('/api/v1/search?q=zzznomatch', {
      headers: { 'x-plandesk-workspace-id': wsA },
    });
    expect(res.status).toBe(200);
    const body = await parseJson<SearchPayload>(res);
    expect(body.tasks).toEqual([]);
    expect(body.documents).toEqual([]);
    expect(body.notes).toEqual([]);
  });
});
