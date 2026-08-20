import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import {
  createTask,
  deleteTask,
  patchProject,
  patchTask,
  type SerializedGoal,
  type SerializedTag,
  type SerializedTask,
} from '../../lib/api.js';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  Toaster: () => null,
}));
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
    goal_id: 'goal-1',
    label,
    status,
    priority: 'medium',
    description: null,
    x: 0,
    y: 0,
    assignee: null,
    due_date: null,
    commit_refs: [],
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
    tags,
  };
}

async function renderBoard(tasks: SerializedTask[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Board projectId={projectId} tasks={tasks} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  const view = render(<RouterProvider router={router} />);
  await router.load();
  return view;
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

    const { container } = await renderBoard(tasks);

    await waitFor(() => {
      expect(screen.getByText('Plan sprint')).toBeTruthy();
      expect(screen.getByText('Write tests')).toBeTruthy();
      expect(screen.getByText('Ship board')).toBeTruthy();
    });

    // Five status columns are rendered, each labeled and grouping its tasks.
    const columns = container.querySelectorAll('[data-board-column]');
    expect(columns).toHaveLength(5);
    expect(
      container.querySelector('[data-board-column="scope"]')?.getAttribute('data-board-column'),
    ).toBe('scope');
    expect(container.querySelector('[data-board-column="scope"]')?.textContent).toContain(
      'Plan sprint',
    );
    expect(container.querySelector('[data-board-column="todo"]')?.textContent).toContain(
      'Write tests',
    );
    expect(container.querySelector('[data-board-column="in_progress"]')?.textContent).toContain(
      'Ship board',
    );
  });

  it('shows add task controls in each column', async () => {
    const { container } = await renderBoard([]);
    const columns = container.querySelectorAll('[data-board-column]');
    expect(columns.length).toBe(5);
    for (const column of columns) {
      expect(column.querySelector('[data-add-task]')).toBeTruthy();
    }
  });

  it('clicking a card opens the task detail panel; close dismisses it', async () => {
    await renderBoard([makeTask('t1', 'Plan sprint', 'scope')]);

    fireEvent.click(screen.getByText('Plan sprint'));

    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });
    // Drawer opens in read mode; enter edit mode to reach the Label input.
    fireEvent.click(screen.getByLabelText('Edit task'));
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('Plan sprint');
    expect(screen.getByText('Description')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close task details'));
    expect(screen.queryByLabelText('Task details')).toBeNull();
  });

  it('patches the changed label but leaves an unedited description untouched', async () => {
    await renderBoard([{ ...makeTask('t1', 'Plan sprint', 'scope'), description: 'Details here' }]);

    fireEvent.click(screen.getByText('Plan sprint'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });
    // The rich editor hydrates the existing Markdown description asynchronously.
    await waitFor(() => {
      expect(screen.getByText('Details here')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Edit task'));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Plan sprint v2' } });
    fireEvent.click(screen.getByText('Save details'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      const rawBody = patchCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<
        string,
        unknown
      >;
      expect(body.label).toBe('Plan sprint v2');
      // An unedited description must NOT be re-serialized through the lossy rich
      // round-trip — it stays exactly as the agent authored it (Markdown).
      expect(body).not.toHaveProperty('description');
    });
  });

  it('renders tag chips on task cards', async () => {
    const tasks = [makeTask('t1', 'Tagged card', 'todo', [makeTag('tag-a', 'backend', '#2563eb')])];
    const { container } = await renderBoard(tasks);

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

    await renderBoard([
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
    await renderBoard([makeTask('t1', 'Tagged card', 'todo', [makeTag('tag-a', 'backend')])]);

    fireEvent.click(screen.getByText('Tagged card'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Edit task'));
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
    await renderBoard([
      makeTask('t1', 'Tagged card', 'todo', [
        makeTag('tag-a', 'backend'),
        makeTag('tag-b', 'urgent'),
      ]),
    ]);

    fireEvent.click(screen.getByText('Tagged card'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Edit task'));
    fireEvent.click(screen.getByLabelText('Remove tag backend'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      const rawBody = patchCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as { tags?: string[] };
      expect(body.tags).toEqual(['urgent']);
    });
  });

  it('shows a comments rail inside the task drawer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('/comments')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }),
    );

    await renderBoard([makeTask('t1', 'Commented card', 'todo')]);

    fireEvent.click(screen.getByText('Commented card'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });

    // The CommentsPanel renders inside the drawer with the task target.
    await waitFor(() => {
      expect(screen.getByText(/no comments yet/i)).toBeTruthy();
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

describe('create dialog goal selection', () => {
  function makeGoal(id: string, name: string | null): SerializedGoal {
    return {
      id,
      project_id: projectId,
      name,
      objective: `Objective for ${id}`,
      status: 'active',
      verification_surface: null,
      constraints: null,
      boundaries: null,
      iteration_policy: null,
      stop_condition: null,
      budget: null,
      last_verification: null,
      created_at: '2026-06-07T00:00:00.000Z',
      updated_at: '2026-06-07T00:00:00.000Z',
    };
  }

  function stubBoardFetch(options: {
    goals: SerializedGoal[];
    currentGoalId: string | null;
    createFailureBody?: string;
  }) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string, init?: RequestInit) => {
        if (typeof path === 'string' && path.includes('/goals')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(options.goals),
          });
        }
        if (typeof path === 'string' && path.endsWith(`/projects/${projectId}`)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                id: projectId,
                name: 'Test project',
                description: null,
                owner_id: null,
                overview_document_id: null,
                repo_url: null,
                folder_path: null,
                workspace_id: 'ws-1',
                current_goal_id: options.currentGoalId,
                created_at: '2026-06-07T00:00:00.000Z',
                updated_at: '2026-06-07T00:00:00.000Z',
                summary: { scope: 0, todo: 0, in_progress: 0, done: 0, backlog: 0 },
              }),
          });
        }
        if (typeof path === 'string' && path.includes('/tasks') && init?.method === 'POST') {
          if (options.createFailureBody !== undefined) {
            return Promise.resolve({
              ok: false,
              status: 400,
              text: () => Promise.resolve(options.createFailureBody),
            });
          }
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
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }),
    );
  }

  async function openCreateDialog() {
    fireEvent.click(screen.getByLabelText('Add task to Todo'));
    await waitFor(() => {
      expect(screen.getByLabelText('Task')).toBeTruthy();
    });
  }

  it('requires choosing a goal when several are active and none is current', async () => {
    stubBoardFetch({ goals: [makeGoal('goal-1', 'first'), makeGoal('goal-2', 'second')], currentGoalId: null });
    await renderBoard([]);
    await openCreateDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Goal')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Pick me a goal' } });

    const create = screen.getByRole('button', { name: 'Create task' });
    expect(create.hasAttribute('disabled')).toBe(true);
  });

  it('sends the current goal as goal_id when it is preselected', async () => {
    stubBoardFetch({ goals: [makeGoal('goal-1', 'first'), makeGoal('goal-2', 'second')], currentGoalId: 'goal-2' });
    await renderBoard([]);
    await openCreateDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Goal')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Current goal task' } });
    const create = screen.getByRole('button', { name: 'Create task' });
    await waitFor(() => {
      expect(create.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(create);

    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init)?.method === 'POST');
      expect(post).toBeTruthy();
      const body = JSON.parse((post?.[1] as RequestInit).body as string) as {
        label: string;
        goal_id?: string;
      };
      expect(body.goal_id).toBe('goal-2');
      expect(body.label).toBe('Current goal task');
    });
  });

  it('omits goal_id and hides the picker when a single goal is active', async () => {
    stubBoardFetch({ goals: [makeGoal('goal-1', 'only')], currentGoalId: null });
    await renderBoard([]);
    await openCreateDialog();

    expect(screen.queryByLabelText('Goal')).toBeNull();
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Single goal task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init)?.method === 'POST');
      expect(post).toBeTruthy();
      const body = JSON.parse((post?.[1] as RequestInit).body as string) as Record<string, unknown>;
      expect('goal_id' in body).toBe(false);
    });
  });

  it('surfaces the server message in a toast when create fails', async () => {
    stubBoardFetch({
      goals: [makeGoal('goal-1', 'first'), makeGoal('goal-2', 'second')],
      currentGoalId: 'goal-2',
      createFailureBody: JSON.stringify({
        error: 'invalid_argument',
        message: 'Multiple active goals: pick one.',
      }),
    });
    await renderBoard([]);
    await openCreateDialog();

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Doomed task' } });
    const create = screen.getByRole('button', { name: 'Create task' });
    await waitFor(() => {
      expect(create.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(create);

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Multiple active goals: pick one.');
    });
  });
});
