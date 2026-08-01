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

function openGroupMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Group' }));
}

function openFilterMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
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
  it('Export menu posts the current view state for CSV download', async () => {
    const tasks = [makeTask('t1', 'Export me', 'todo')];
    await renderTaskListReady(tasks);

    const requestUrl = (path: RequestInfo | URL): string => {
      if (typeof path === 'string') {
        return path;
      }
      if (path instanceof URL) {
        return path.href;
      }
      return path.url;
    };

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((path: RequestInfo | URL) => {
      const url = requestUrl(path);
      if (url.endsWith(`/projects/${projectId}/export`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'Content-Disposition': 'attachment; filename="proj-2026-08-01.csv"',
          }),
          blob: () => Promise.resolve(new Blob(['ok'], { type: 'text/csv' })),
          text: () => Promise.resolve(''),
          json: () => Promise.resolve({}),
        }) as Promise<Response>;
      }
      if (url.endsWith(`/projects/${projectId}/goals`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([makeGoal('goal-1', 'Ship list view')]),
        }) as Promise<Response>;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      }) as Promise<Response>;
    });

    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const exportTrigger = screen.getByRole('button', { name: 'Export' });
    fireEvent.pointerDown(exportTrigger, { button: 0 });
    fireEvent.pointerUp(exportTrigger, { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'CSV' }));

    await waitFor(() => {
      const exportCall = fetchMock.mock.calls.find(
        ([path]) => requestUrl(path) === `/api/v1/projects/${projectId}/export`,
      );
      expect(exportCall).toBeDefined();
      const init = exportCall?.[1];
      expect(init?.method).toBe('POST');
      expect(typeof init?.body).toBe('string');
      const body = JSON.parse(init?.body as string) as {
        format: string;
        view: { visibleColumns: string[]; version: number };
      };
      expect(body.format).toBe('csv');
      expect(body.view.version).toBe(1);
      expect(body.view.visibleColumns).toContain('label');
    });
    expect(createObjectURL).toHaveBeenCalled();
  });

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

  it('sub-groups by status inside each goal and collapsing a parent hides nested rows', async () => {
    const goals = [
      makeGoal('goal-a', 'Goal Alpha'),
      makeGoal('goal-b', 'Goal Beta'),
    ];
    const tasks = [
      makeTask('t-a-todo', 'Alpha todo', 'todo', { goal_id: 'goal-a' }),
      makeTask('t-a-scope', 'Alpha scope', 'scope', { goal_id: 'goal-a' }),
      makeTask('t-b-todo', 'Beta todo', 'todo', { goal_id: 'goal-b' }),
    ];

    const { container } = await renderTaskListReady(tasks, { goals });

    await waitFor(() => {
      expect(screen.getByText('Alpha todo')).toBeTruthy();
    });

    openGroupMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add group level' }));
    await waitFor(() => {
      expect(container.querySelector('[data-group-level="0"]')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('Group field 1'), { target: { value: 'goal_id' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add group level' }));
    await waitFor(() => {
      expect(container.querySelector('[data-group-level="1"]')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('Group field 2'), { target: { value: 'status' } });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-group-field="goal_id"]')).toHaveLength(2);
      expect(
        container.querySelectorAll('[data-group-field="status"]').length,
      ).toBeGreaterThanOrEqual(2);
    });

    const alphaParent = [...container.querySelectorAll('[data-group-field="goal_id"]')].find(
      (row) => row.textContent.includes('Goal Alpha'),
    );
    if (alphaParent === undefined) {
      throw new Error('expected Goal Alpha group row');
    }
    const alphaId = alphaParent.getAttribute('data-group-id');
    if (alphaId === null) {
      throw new Error('expected data-group-id on Goal Alpha group row');
    }
    expect(container.querySelectorAll(`[data-group-id^="${alphaId}/"]`).length).toBeGreaterThanOrEqual(
      2,
    );

    fireEvent.click(screen.getByLabelText('Collapse group Goal Alpha'));

    await waitFor(() => {
      expect(
        container.querySelector(`[data-group-id="${alphaId}"]`)?.getAttribute('data-group-collapsed'),
      ).toBe('true');
      expect(container.querySelector('[data-task-id="t-a-todo"]')).toBeNull();
      expect(container.querySelector('[data-task-id="t-a-scope"]')).toBeNull();
      expect(container.querySelectorAll(`[data-group-id^="${alphaId}/"]`)).toHaveLength(0);
      expect(container.querySelector('[data-task-id="t-b-todo"]')).toBeTruthy();
    });

    // Re-render via an unrelated UI change; collapse state must stick.
    openColumnsMenu();
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Assignee' }));

    await waitFor(() => {
      expect(container.querySelector('[data-list-column="assignee"]')).toBeNull();
      expect(
        container.querySelector(`[data-group-id="${alphaId}"]`)?.getAttribute('data-group-collapsed'),
      ).toBe('true');
      expect(container.querySelector('[data-task-id="t-a-todo"]')).toBeNull();
    });

    fireEvent.click(screen.getByLabelText('Expand group Goal Alpha'));
    await waitFor(() => {
      expect(container.querySelector('[data-task-id="t-a-todo"]')).toBeTruthy();
      expect(container.querySelector('[data-task-id="t-a-scope"]')).toBeTruthy();
    });
  });

  it('filter menu hides operators that are invalid for the selected field', async () => {
    await renderTaskListReady([makeTask('t1', 'Only', 'todo')]);

    await waitFor(() => {
      expect(screen.getByText('Only')).toBeTruthy();
    });

    openFilterMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition to root' }));

    const fieldSelect = await screen.findByLabelText('Filter field root.0');
    fireEvent.change(fieldSelect, { target: { value: 'status' } });

    const operatorSelect = screen.getByLabelText('Filter operator root.0');
    const statusOptions = [...operatorSelect.querySelectorAll('option')].map(
      (option) => option.getAttribute('value'),
    );
    expect(statusOptions).toContain('is');
    expect(statusOptions).not.toContain('before');
    expect(statusOptions).not.toContain('contains');

    fireEvent.change(fieldSelect, { target: { value: 'due_date' } });
    await waitFor(() => {
      const dateOptions = [...screen.getByLabelText('Filter operator root.0').querySelectorAll('option')].map(
        (option) => option.getAttribute('value'),
      );
      expect(dateOptions).toContain('before');
      expect(dateOptions).toContain('after');
      expect(dateOptions).not.toContain('contains');
    });

    fireEvent.change(fieldSelect, { target: { value: 'tags' } });
    await waitFor(() => {
      const tagsOperator = screen.getByLabelText('Filter operator root.0');
      expect(tagsOperator).toHaveProperty('value', 'contains');
      const tagOptions = [...tagsOperator.querySelectorAll('option')].map((option) =>
        option.getAttribute('value'),
      );
      expect(tagOptions).toContain('contains');
      expect(tagOptions).not.toContain('before');
    });
  });

  it('nested filter updates visible rows without a refetch', async () => {
    const tasks = [
      makeTask('full-todo', 'Full todo', 'todo', {
        tags: [makeTag('l1', 'lane:full')],
      }),
      makeTask('full-scope', 'Full scope', 'scope', {
        tags: [makeTag('l2', 'lane:full')],
      }),
      makeTask('auto-todo', 'Auto todo', 'todo', {
        tags: [makeTag('l3', 'lane:auto')],
      }),
      makeTask('full-done', 'Full done', 'done', {
        tags: [makeTag('l4', 'lane:full')],
      }),
    ];

    const { container } = await renderTaskListReady(tasks);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-task-list] tbody tr')).toHaveLength(4);
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const callsBefore = fetchMock.mock.calls.length;

    openFilterMenu();
    // lane is full
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition to root' }));
    fireEvent.change(screen.getByLabelText('Filter field root.0'), { target: { value: 'lane' } });
    fireEvent.change(screen.getByLabelText('Filter value root.0'), { target: { value: 'full' } });

    // nested OR group: status todo OR scope
    fireEvent.click(screen.getByRole('button', { name: 'Add group to root' }));
    fireEvent.change(screen.getByLabelText('Filter group op root.1'), { target: { value: 'or' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition to root.1' }));
    fireEvent.change(screen.getByLabelText('Filter field root.1.0'), { target: { value: 'status' } });
    fireEvent.change(screen.getByLabelText('Filter value root.1.0'), { target: { value: 'todo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition to root.1' }));
    fireEvent.change(screen.getByLabelText('Filter field root.1.1'), { target: { value: 'status' } });
    fireEvent.change(screen.getByLabelText('Filter value root.1.1'), { target: { value: 'scope' } });

    await waitFor(() => {
      const ids = [...container.querySelectorAll('[data-task-list] tbody tr')].map((row) =>
        row.getAttribute('data-task-id'),
      );
      expect(ids.sort()).toEqual(['full-scope', 'full-todo']);
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('grouping by tag shows a two-tag task twice and notes that totals exceed the task count', async () => {
    const tasks = [
      makeTask('t-both', 'Both tags', 'todo', {
        tags: [makeTag('tag-a', 'alpha'), makeTag('tag-b', 'beta')],
      }),
      makeTask('t-one', 'One tag', 'todo', { tags: [makeTag('tag-a2', 'alpha')] }),
    ];

    const { container } = await renderTaskListReady(tasks);

    await waitFor(() => {
      expect(screen.getByText('Both tags')).toBeTruthy();
    });

    openGroupMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add group level' }));
    fireEvent.change(await screen.findByLabelText('Group field 1'), {
      target: { value: 'tag' },
    });

    await waitFor(() => {
      const tagNote = container.querySelector('[data-group-tag-note]');
      expect(tagNote).toBeTruthy();
      if (tagNote === null) {
        throw new Error('expected tag fan-out note');
      }
      expect(tagNote.textContent.toLowerCase()).toMatch(/exceed/);
      expect(container.querySelectorAll('tr[data-task-id="t-both"]')).toHaveLength(2);
    });
  });
});
