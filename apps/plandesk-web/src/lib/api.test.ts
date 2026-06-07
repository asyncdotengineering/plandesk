import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  getProject,
  listProjects,
  listTasks,
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
});
