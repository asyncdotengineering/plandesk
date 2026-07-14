import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  createTask,
  deleteDocument,
  deleteEdge,
  deleteProject,
  deleteTask,
  getDocument,
  getProject,
  listProjects,
  listTasks,
  patchDocument,
  patchProject,
  patchTask,
  type SerializedDocument,
  type SerializedProject,
  type SerializedProjectDetail,
  type SerializedTask,
} from './api.js';

const sampleProject: SerializedProject = {
  id: 'proj-1',
  name: 'Alpha',
  description: null,
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

const sampleProjectDetail: SerializedProjectDetail = {
  ...sampleProject,
  summary: {
    scope: 0,
    todo: 2,
    in_progress: 1,
    done: 0,
    backlog: 0,
  },
};

const sampleTask: SerializedTask = {
  id: 'task-1',
  project_id: 'proj-1',
  goal_id: 'goal-1',
  label: 'Task one',
  status: 'todo',
  description: null,
  x: 0,
  y: 0,
  assignee: null,
  due_date: null,
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

const sampleDocument: SerializedDocument = {
  id: 'doc-1',
  project_id: 'proj-1',
  title: 'Spec',
  body: '<p>Hello</p>',
  status_line: 'Status: draft',
  parent_id: null,
  folder_id: null,
  linked_task_id: 'task-1',
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

function mockFetch(response: unknown, init?: { ok?: boolean; status?: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      text: () => Promise.resolve(JSON.stringify(response)),
      json: () => Promise.resolve(response),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectFetchCall(path: string, init?: Partial<RequestInit>) {
  expect(fetch).toHaveBeenCalledTimes(1);
  const [calledPath, calledInit] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(calledPath).toBe(path);
  const headers = new Headers(calledInit?.headers);
  expect(headers.get('Content-Type')).toBe('application/json');
  if (init?.method !== undefined) {
    expect(calledInit?.method).toBe(init.method);
  }
  if (init?.body !== undefined) {
    expect(calledInit?.body).toBe(init.body);
  }
}

describe('api client', () => {
  it('listProjects fetches GET /api/v1/projects', async () => {
    mockFetch([sampleProject]);
    const result = await listProjects();
    expectFetchCall('/api/v1/projects');
    expect(result).toEqual([sampleProject]);
  });

  it('createProject posts snake_case body', async () => {
    mockFetch(sampleProject);
    const result = await createProject({ name: 'Alpha', description: 'desc' });
    expectFetchCall('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha', description: 'desc' }),
    });
    expect(result).toEqual(sampleProject);
  });

  it('getProject returns detail with summary', async () => {
    mockFetch(sampleProjectDetail);
    const result = await getProject('proj-1');
    expectFetchCall('/api/v1/projects/proj-1');
    expect(result.summary.todo).toBe(2);
  });

  it('listTasks appends status query param', async () => {
    mockFetch([sampleTask]);
    const result = await listTasks('proj-1', { status: 'todo' });
    expectFetchCall('/api/v1/projects/proj-1/tasks?status=todo');
    expect(result[0]?.status).toBe('todo');
  });

  it('createTask posts snake_case body', async () => {
    mockFetch(sampleTask, { status: 201 });
    const result = await createTask('proj-1', {
      label: 'New task',
      status: 'todo',
      x: 10,
      y: 20,
      assignee: 'agent',
      due_date: '2026-12-01T00:00:00.000Z',
    });
    expectFetchCall('/api/v1/projects/proj-1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        label: 'New task',
        status: 'todo',
        x: 10,
        y: 20,
        assignee: 'agent',
        due_date: '2026-12-01T00:00:00.000Z',
      }),
    });
    expect(result).toEqual(sampleTask);
  });

  it('deleteTask sends DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );
    await deleteTask('task-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/tasks/task-1', {
      method: 'DELETE',
      headers: expect.any(Headers) as Headers,
      credentials: 'include',
    });
  });

  it('patchProject sends PATCH with name', async () => {
    mockFetch(sampleProject);
    const result = await patchProject('proj-1', { name: 'Renamed' });
    expectFetchCall('/api/v1/projects/proj-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(result).toEqual(sampleProject);
  });

  it('deleteProject sends DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );
    await deleteProject('proj-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
      method: 'DELETE',
      headers: expect.any(Headers) as Headers,
      credentials: 'include',
    });
  });

  it('deleteDocument sends DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );
    await deleteDocument('doc-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/documents/doc-1', {
      method: 'DELETE',
      headers: expect.any(Headers) as Headers,
      credentials: 'include',
    });
  });

  it('deleteEdge sends DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );
    await deleteEdge('proj-1', 'edge-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/projects/proj-1/edges/edge-1', {
      method: 'DELETE',
      headers: expect.any(Headers) as Headers,
      credentials: 'include',
    });
  });

  it('patchTask sends PATCH with assignee and due_date', async () => {
    mockFetch(sampleTask);
    await patchTask('task-1', {
      label: 'Updated',
      assignee: 'alice',
      due_date: '2026-12-01T00:00:00.000Z',
    });
    expectFetchCall('/api/v1/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({
        label: 'Updated',
        assignee: 'alice',
        due_date: '2026-12-01T00:00:00.000Z',
      }),
    });
  });

  it('patchDocument sends PATCH with body and status_line', async () => {
    mockFetch(sampleDocument);
    const result = await patchDocument('doc-1', {
      body: '<p>Updated</p>',
      status_line: 'Status: done',
      title: 'Spec',
    });
    expectFetchCall('/api/v1/documents/doc-1', {
      method: 'PATCH',
      body: JSON.stringify({
        body: '<p>Updated</p>',
        status_line: 'Status: done',
        title: 'Spec',
      }),
    });
    expect(result).toEqual(sampleDocument);
  });

  it('getDocument fetches GET /api/v1/documents/:id', async () => {
    mockFetch(sampleDocument);
    const result = await getDocument('doc-1');
    expectFetchCall('/api/v1/documents/doc-1');
    expect(result.body).toBe('<p>Hello</p>');
  });

  it('listMcpTokens fetches GET /api/v1/mcp-tokens', async () => {
    const sampleMcpToken = {
      id: 'tok-1',
      name: 'Claude',
      created_at: '2026-06-07T00:00:00.000Z',
      revoked_at: null,
    };
    mockFetch([sampleMcpToken]);
    const { listMcpTokens } = await import('./api.js');
    const result = await listMcpTokens();
    expectFetchCall('/api/v1/mcp-tokens');
    expect(result[0]).toEqual(sampleMcpToken);
    expect(result[0]).not.toHaveProperty('token');
  });

  it('createMcpToken posts name and returns raw once', async () => {
    const created = {
      id: 'tok-1',
      name: 'Codex',
      token: 'plandesk_mcp_secret',
      created_at: '2026-06-07T00:00:00.000Z',
      revoked_at: null,
    };
    mockFetch(created);
    const { createMcpToken } = await import('./api.js');
    const result = await createMcpToken('Codex');
    expectFetchCall('/api/v1/mcp-tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Codex' }),
    });
    expect(result.token).toBe('plandesk_mcp_secret');
  });

  it('revokeMcpToken sends DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );
    const { revokeMcpToken } = await import('./api.js');
    await revokeMcpToken('tok-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/mcp-tokens/tok-1', {
      method: 'DELETE',
      headers: expect.any(Headers) as Headers,
      credentials: 'include',
    });
  });

  it('listAgentRuns fetches GET /api/v1/projects/:id/agent-runs', async () => {
    const sampleRuns = [
      {
        id: 'run-1',
        project_id: 'proj-1',
        status: 'running' as const,
        label: 'Worker',
        started_at: '2026-06-08T12:00:00.000Z',
        completed_at: null,
        events: [{ id: 'evt-1', message: 'Step', created_at: '2026-06-08T12:00:01.000Z' }],
      },
    ];
    mockFetch(sampleRuns);
    const { listAgentRuns } = await import('./api.js');
    const result = await listAgentRuns('proj-1');
    expectFetchCall('/api/v1/projects/proj-1/agent-runs');
    expect(result).toEqual(sampleRuns);
  });
});
