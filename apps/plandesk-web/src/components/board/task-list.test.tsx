import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedGoal, SerializedTag, SerializedTask } from '../../lib/api.js';
import { TaskList } from './TaskList.js';

const projectId = 'proj-1';

// Radix DropdownMenu opens on pointer events; jsdom needs these polyfills.
function stubPointer() {
  const el = window.Element.prototype as unknown as Record<string, () => unknown>;
  el.hasPointerCapture = () => false;
  el.setPointerCapture = () => undefined;
  el.releasePointerCapture = () => undefined;
  el.scrollIntoView = () => undefined;
}

function openColumnsMenu() {
  const trigger = screen.getByRole('button', { name: 'Columns' });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0 });
}

function openSortMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
}

function makeTag(id: string, name: string): SerializedTag {
  return {
    id,
    project_id: projectId,
    name,
    color: null,
    created_at: '2026-06-07T00:00:00.000Z',
  };
}

function makeTask(
  id: string,
  label: string,
  status: SerializedTask['status'],
  overrides: Partial<SerializedTask> = {},
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
    updated_at: '2026-06-08T00:00:00.000Z',
    tags: [],
    ...overrides,
  };
}

function makeGoal(id: string, objective: string): SerializedGoal {
  return {
    id,
    project_id: projectId,
    objective,
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

function renderTaskList(
  tasks: SerializedTask[],
  options?: {
    openTaskId?: string;
    onOpenTaskIdChange?: (taskId: string | null) => void;
    goals?: SerializedGoal[];
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const goals = options?.goals ?? [makeGoal('goal-1', 'Ship list view')];

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith(`/projects/${projectId}/goals`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(goals),
        });
      }
      if (typeof path === 'string' && path.includes('/comments')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
    }),
  );

  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <TaskList
            projectId={projectId}
            tasks={tasks}
            openTaskId={options?.openTaskId}
            onOpenTaskIdChange={options?.onOpenTaskIdChange}
          />
        </QueryClientProvider>
      ),
    }),
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { ...view, router, goals };
}

async function renderTaskListReady(
  tasks: SerializedTask[],
  options?: Parameters<typeof renderTaskList>[1],
) {
  const view = renderTaskList(tasks, options);
  await view.router.load();
  return view;
}

beforeEach(() => {
  stubPointer();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaskList', () => {
  it('renders every task as a row across several goals', async () => {
    const goals = [
      makeGoal('goal-a', 'Goal Alpha'),
      makeGoal('goal-b', 'Goal Beta'),
    ];
    const tasks = [
      makeTask('t1', 'Alpha task', 'todo', { goal_id: 'goal-a' }),
      makeTask('t2', 'Beta task', 'done', { goal_id: 'goal-b' }),
      makeTask('t3', 'Another alpha', 'scope', { goal_id: 'goal-a' }),
    ];

    const { container } = await renderTaskListReady(tasks, { goals });

    await waitFor(() => {
      expect(screen.getByText('Alpha task')).toBeTruthy();
      expect(screen.getByText('Beta task')).toBeTruthy();
      expect(screen.getByText('Another alpha')).toBeTruthy();
    });

    expect(container.querySelectorAll('[data-list-cell="goal"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Goal Alpha').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Goal Beta').length).toBeGreaterThanOrEqual(1);

    const rows = container.querySelectorAll('[data-task-list] tbody tr');
    expect(rows).toHaveLength(3);
  });

  it('hiding a column removes it from the header and every row', async () => {
    const tasks = [
      makeTask('t1', 'Tagged row', 'todo', {
        assignee: 'alex@example.com',
        tags: [makeTag('tag-1', 'backend')],
      }),
    ];

    const { container } = await renderTaskListReady(tasks);

    await waitFor(() => {
      expect(screen.getByText('Tagged row')).toBeTruthy();
    });

    expect(container.querySelector('[data-list-column="assignee"]')).toBeTruthy();
    expect(container.querySelector('[data-list-cell="assignee"]')?.textContent).toContain(
      'alex@example.com',
    );

    openColumnsMenu();
    const assigneeItem = await screen.findByRole('menuitemcheckbox', { name: 'Assignee' });
    fireEvent.click(assigneeItem);

    await waitFor(() => {
      expect(container.querySelector('[data-list-column="assignee"]')).toBeNull();
      expect(container.querySelector('[data-list-cell="assignee"]')).toBeNull();
    });

    expect(screen.getByText('Tagged row')).toBeTruthy();
    expect(container.querySelector('[data-list-column="label"]')).toBeTruthy();
  });

  it('uses the API blocked field when it disagrees with a naive waiting_on derivation', async () => {
    // Naive derivation: waiting_on.length > 0 ⇒ blocked. API says otherwise.
    const apiBlockedNoWaiting = makeTask('t-blocked', 'Server blocked', 'todo', {
      blocked: true,
      waiting_on: [],
    });
    const apiClearWithWaiting = makeTask('t-clear', 'Server clear', 'todo', {
      blocked: false,
      waiting_on: ['prereq-unfinished'],
    });

    const { container } = await renderTaskListReady([apiBlockedNoWaiting, apiClearWithWaiting]);

    await waitFor(() => {
      expect(screen.getByText('Server blocked')).toBeTruthy();
      expect(screen.getByText('Server clear')).toBeTruthy();
    });

    const blockedRow = container.querySelector('[data-task-id="t-blocked"]');
    const clearRow = container.querySelector('[data-task-id="t-clear"]');
    expect(blockedRow?.querySelector('[data-blocked]')).toBeTruthy();
    expect(clearRow?.querySelector('[data-blocked]')).toBeNull();
  });

  it('row click opens the drawer and reports the task id for the URL', async () => {
    const onOpenTaskIdChange = vi.fn();
    await renderTaskListReady([makeTask('t-open', 'Open me', 'todo')], { onOpenTaskIdChange });

    await waitFor(() => {
      expect(screen.getByText('Open me')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Open me'));

    await waitFor(() => {
      expect(screen.getByLabelText('Task details')).toBeTruthy();
    });
    expect(onOpenTaskIdChange).toHaveBeenCalledWith('t-open');
  });

  it('renders an empty state when the project has no tasks', async () => {
    const { container } = await renderTaskListReady([]);

    await waitFor(() => {
      expect(screen.getByText('No tasks yet.')).toBeTruthy();
    });
    expect(container.querySelector('[data-task-list]')).toBeNull();
    expect(container.querySelector('[data-list-column]')).toBeNull();
  });

  it('sort menu reorders rows by the chosen field', async () => {
    const tasks = [
      makeTask('t-scope', 'Scope row', 'scope'),
      makeTask('t-progress', 'Progress row', 'in_progress'),
      makeTask('t-todo', 'Todo row', 'todo'),
    ];

    const { container } = await renderTaskListReady(tasks);

    await waitFor(() => {
      expect(screen.getByText('Scope row')).toBeTruthy();
    });

    const idsBefore = [...container.querySelectorAll('[data-task-list] tbody tr')].map(
      (row) => row.getAttribute('data-task-id'),
    );
    expect(idsBefore).toEqual(['t-scope', 't-progress', 't-todo']);

    openSortMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add sort level' }));

    await waitFor(() => {
      expect(container.querySelector('[data-sort-level="0"]')).toBeTruthy();
    });

    const fieldSelect = screen.getByLabelText('Sort field 1');
    fireEvent.change(fieldSelect, { target: { value: 'status' } });

    await waitFor(() => {
      const ids = [...container.querySelectorAll('[data-task-list] tbody tr')].map((row) =>
        row.getAttribute('data-task-id'),
      );
      expect(ids).toEqual(['t-scope', 't-todo', 't-progress']);
    });
  });
});
