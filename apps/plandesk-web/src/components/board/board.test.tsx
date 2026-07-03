import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTask,
  deleteTask,
  patchProject,
  patchTask,
  type SerializedTag,
  type SerializedTask,
} from '../../lib/api.js';
import { Board } from './Board.js';
import { filterTasksByAnyTag, groupTasksByStatus, resolveDropStatus } from './board-utils.js';
import { statusFromDragEnd } from './useBoardDnd.js';

const projectId = 'proj-1';

function makeTag(id: string, name: string, color: string | null = null): SerializedTag {
  return {
    id,
    project_id: projectId,
    name,
    color,
    created_at: '2026-06-07T00:00:00.000Z',
  };
}

function makeTask(
  id: string,
  label: string,
  status: SerializedTask['status'],
  tags: SerializedTag[] = [],
): SerializedTask {
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
    tags,
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

  it('filterTasksByAnyTag uses OR semantics across selected tags', () => {
    const a = makeTag('tag-a', 'a');
    const b = makeTag('tag-b', 'b');
    const tasks = [
      makeTask('t1', 'Has a', 'todo', [a]),
      makeTask('t2', 'Has b', 'todo', [b]),
      makeTask('t3', 'Has both', 'todo', [a, b]),
      makeTask('t4', 'Untagged', 'todo'),
    ];

    expect(filterTasksByAnyTag(tasks, [])).toHaveLength(4);
    expect(filterTasksByAnyTag(tasks, ['tag-a']).map((task) => task.id)).toEqual(['t1', 't3']);
    // OR: matching ANY selected tag keeps the task
    expect(filterTasksByAnyTag(tasks, ['tag-a', 'tag-b']).map((task) => task.id)).toEqual([
      't1',
      't2',
      't3',
    ]);
    expect(filterTasksByAnyTag(tasks, ['missing'])).toHaveLength(0);
  });

  it('filterTasksByAnyTag treats tasks without a tags payload as unmatched', () => {
    const bare = { ...makeTask('t1', 'No tags field', 'todo') };
    delete (bare as { tags?: SerializedTag[] }).tags;
    expect(filterTasksByAnyTag([bare], ['tag-a'])).toHaveLength(0);
    expect(filterTasksByAnyTag([bare], [])).toHaveLength(1);
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

  it('clicking a card opens the task detail panel; close dismisses it', async () => {
    renderBoard([makeTask('t1', 'Plan sprint', 'scope')]);

    fireEvent.click(screen.getByText('Plan sprint'));

    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('Plan sprint');
    expect(screen.getByLabelText('Description')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close task details'));
    expect(screen.queryByLabelText('Task details')).toBeNull();
  });

  it('saving the detail panel patches the task', async () => {
    renderBoard([makeTask('t1', 'Plan sprint', 'scope')]);

    fireEvent.click(screen.getByText('Plan sprint'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Plan sprint v2' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Details here' } });
    fireEvent.click(screen.getByText('Save details'));

    await waitFor(() => {
      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      const rawBody = patchCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<
        string,
        unknown
      >;
      expect(body.label).toBe('Plan sprint v2');
      expect(body.description).toBe('Details here');
    });
  });

  it('renders tag chips on task cards', async () => {
    const tasks = [
      makeTask('t1', 'Tagged card', 'todo', [makeTag('tag-a', 'backend', '#2563eb')]),
    ];
    const { container } = renderBoard(tasks);

    await waitFor(() => {
      expect(screen.getByText('Tagged card')).toBeTruthy();
    });
    const chip = container.querySelector('[data-tag-chip="backend"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('backend');
  });

  it('tag filter control shows only tasks matching ANY selected tag; clear restores', async () => {
    const a = makeTag('tag-a', 'frontend');
    const b = makeTag('tag-b', 'backend');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (typeof path === 'string' && path.endsWith('/tags') && init?.method === undefined) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([a, b]),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }),
    );

    renderBoard([
      makeTask('t1', 'Frontend task', 'todo', [a]),
      makeTask('t2', 'Backend task', 'todo', [b]),
      makeTask('t3', 'Untagged task', 'todo'),
    ]);

    await waitFor(() => {
      expect(screen.getByLabelText('Filter by tag')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'frontend' }));
    expect(screen.getByText('Frontend task')).toBeTruthy();
    expect(screen.queryByText('Backend task')).toBeNull();
    expect(screen.queryByText('Untagged task')).toBeNull();

    // selecting a second tag widens the match (OR semantics)
    fireEvent.click(screen.getByRole('button', { name: 'backend' }));
    expect(screen.getByText('Frontend task')).toBeTruthy();
    expect(screen.getByText('Backend task')).toBeTruthy();
    expect(screen.queryByText('Untagged task')).toBeNull();

    fireEvent.click(screen.getByText('Clear filter'));
    expect(screen.getByText('Untagged task')).toBeTruthy();
  });

  it('adding a tag from the detail panel patches the full replacement set', async () => {
    renderBoard([makeTask('t1', 'Tagged card', 'todo', [makeTag('tag-a', 'backend')])]);

    fireEvent.click(screen.getByText('Tagged card'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'urgent' } });
    fireEvent.click(screen.getByText('Add tag'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      const rawBody = patchCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as { tags?: string[] };
      expect(body.tags).toEqual(['backend', 'urgent']);
    });
  });

  it('removing a tag from the detail panel patches the remaining set', async () => {
    renderBoard([
      makeTask('t1', 'Tagged card', 'todo', [makeTag('tag-a', 'backend'), makeTag('tag-b', 'urgent')]),
    ]);

    fireEvent.click(screen.getByText('Tagged card'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Remove tag backend'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      const rawBody = patchCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as { tags?: string[] };
      expect(body.tags).toEqual(['urgent']);
    });
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
