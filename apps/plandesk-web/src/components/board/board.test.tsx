import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTask,
  deleteTask,
  patchProject,
  patchTask,
  type SerializedTask,
} from '../../lib/api.js';
import { Board } from './Board.js';
import { groupTasksByStatus, resolveDropStatus } from './board-utils.js';
import { statusFromDragEnd } from './useBoardDnd.js';

const projectId = 'proj-1';

function makeTask(id: string, label: string, status: SerializedTask['status']): SerializedTask {
  return {
    id,
    project_id: projectId,
    label,
    status,
    description: null,
    x: 0,
    y: 0,
    assignee: null,
    due_date: null,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
  };
}

function renderBoard(tasks: SerializedTask[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Board projectId={projectId} tasks={tasks} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (typeof path === 'string' && path.includes('/tasks') && init?.method === 'POST') {
        const rawBody = init.body;
        const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as {
          label: string;
          status: SerializedTask['status'];
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve(makeTask('new-task', body.label, body.status)),
        });
      }
      if (typeof path === 'string' && path.includes('/tasks/') && init?.method === 'PATCH') {
        const rawBody = init.body;
        const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as {
          status?: SerializedTask['status'];
          label?: string;
        };
        const taskId = path.split('/').pop() ?? '';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(makeTask(taskId, body.label ?? 'Updated', body.status ?? 'todo')),
        });
      }
      if (typeof path === 'string' && path.includes('/tasks/') && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 204,
          text: () => Promise.resolve(''),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('board utils', () => {
  it('groups tasks by status into five columns', () => {
    const tasks = [
      makeTask('t1', 'Scope item', 'scope'),
      makeTask('t2', 'Todo item', 'todo'),
      makeTask('t3', 'Doing item', 'in_progress'),
      makeTask('t4', 'Done item', 'done'),
      makeTask('t5', 'Backlog item', 'backlog'),
    ];

    const grouped = groupTasksByStatus(tasks);

    expect(grouped.scope).toHaveLength(1);
    expect(grouped.todo).toHaveLength(1);
    expect(grouped.in_progress).toHaveLength(1);
    expect(grouped.done).toHaveLength(1);
    expect(grouped.backlog).toHaveLength(1);
    expect(grouped.todo[0]?.label).toBe('Todo item');
  });

  it('resolveDropStatus maps column id or card id to status', () => {
    const tasks = [makeTask('t1', 'Todo item', 'todo'), makeTask('t2', 'Done item', 'done')];
    const tasksById = new Map(tasks.map((task) => [task.id, task]));

    expect(resolveDropStatus('in_progress', tasksById)).toBe('in_progress');
    expect(resolveDropStatus('t2', tasksById)).toBe('done');
    expect(resolveDropStatus('missing', tasksById)).toBeUndefined();
  });

  it('statusFromDragEnd returns PATCH payload when column changes', () => {
    const tasks = [makeTask('t1', 'Todo item', 'todo')];
    const result = statusFromDragEnd({ active: { id: 't1' }, over: { id: 'done' } }, tasks);

    expect(result).toEqual({ taskId: 't1', status: 'done' });
  });

  it('statusFromDragEnd returns null when status unchanged', () => {
    const tasks = [makeTask('t1', 'Todo item', 'todo')];
    const result = statusFromDragEnd({ active: { id: 't1' }, over: { id: 'todo' } }, tasks);

    expect(result).toBeNull();
  });
});

describe('Board', () => {
  it('renders tasks grouped by status columns', async () => {
    const tasks = [
      makeTask('t1', 'Plan sprint', 'scope'),
      makeTask('t2', 'Write tests', 'todo'),
      makeTask('t3', 'Ship board', 'in_progress'),
    ];

    renderBoard(tasks);

    await waitFor(() => {
      expect(screen.getByText('Plan sprint')).toBeTruthy();
      expect(screen.getByText('Write tests')).toBeTruthy();
      expect(screen.getByText('Ship board')).toBeTruthy();
    });

    expect(screen.getByText('Scope')).toBeTruthy();
    expect(screen.getByText('Todo')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Backlog')).toBeTruthy();
  });

  it('shows add task controls in each column', () => {
    const { container } = renderBoard([]);
    const columns = container.querySelectorAll('[data-board-column]');
    expect(columns.length).toBe(5);
    for (const column of columns) {
      expect(column.textContent).toContain('+ Add task');
    }
  });

  it('createTask posts with label and column status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve(makeTask('new-1', 'Board task', 'todo')),
      }),
    );

    await createTask('proj-1', { label: 'Board task', status: 'todo' });

    const [, calledInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(calledInit?.method).toBe('POST');
    expect(calledInit?.body).toBe(JSON.stringify({ label: 'Board task', status: 'todo' }));
  });
});

describe('patchTask drag mapping', () => {
  it('patchTask sends PATCH with status from drag target column', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeTask('t1', 'Todo item', 'done')),
      }),
    );

    await patchTask('t1', { status: 'done' });

    const [, calledInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(calledInit?.method).toBe('PATCH');
    expect(calledInit?.body).toBe(JSON.stringify({ status: 'done' }));
    const headers = new Headers(calledInit?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});

describe('deleteTask', () => {
  it('deleteTask sends DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      }),
    );

    await deleteTask('t1');

    const [, calledInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(calledInit?.method).toBe('DELETE');
  });
});

describe('patchProject', () => {
  it('patchProject sends PATCH with name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'proj-1',
            name: 'Renamed',
            description: null,
            created_at: '2026-06-07T00:00:00.000Z',
            updated_at: '2026-06-07T00:00:00.000Z',
          }),
      }),
    );

    await patchProject('proj-1', { name: 'Renamed' });

    const [, calledInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(calledInit?.method).toBe('PATCH');
    expect(calledInit?.body).toBe(JSON.stringify({ name: 'Renamed' }));
  });
});
