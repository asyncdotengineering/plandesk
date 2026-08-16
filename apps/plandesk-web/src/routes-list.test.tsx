import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerializedTask } from './lib/api.js';
import { encodeFilterParam } from './lib/search.js';
import { routeTree } from './routeTree.gen.js';

const projectId = 'proj-1';

const browserSession = {
  kind: 'session' as const,
  user_ref: 'github:1',
  role: 'editor' as const,
  org: { id: 'org-2', name: 'Acme' },
  orgs: [{ id: 'org-2', name: 'Acme', role: 'member' }],
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
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

function stubListFetch(tasks: SerializedTask[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.endsWith('/auth/session')) {
        return jsonResponse(browserSession);
      }
      if (url.includes('/workspaces')) {
        return jsonResponse([]);
      }
      if (url.includes('/tasks')) {
        return jsonResponse(tasks);
      }
      if (url.includes('/goals') || url.includes('/tags') || url.includes('/documents')) {
        return jsonResponse([]);
      }
      if (url.includes('/projects/')) {
        return jsonResponse({
          id: projectId,
          name: 'List Project',
          description: null,
          repo_url: null,
          created_at: '2026-06-07T00:00:00.000Z',
          updated_at: '2026-06-07T00:00:00.000Z',
        });
      }
      return jsonResponse([]);
    }),
  );
}

function stubPointer() {
  const el = window.Element.prototype as unknown as Record<string, () => unknown>;
  el.hasPointerCapture = () => false;
  el.setPointerCapture = () => undefined;
  el.releasePointerCapture = () => undefined;
  el.scrollIntoView = () => undefined;
}

function renderListAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

function openSortMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
}

function laneFullTodoOrScopeFilter() {
  return encodeFilterParam({
    kind: 'group',
    op: 'and',
    children: [
      { kind: 'condition', field: 'lane', operator: 'is', value: 'full' },
      {
        kind: 'group',
        op: 'or',
        children: [
          { kind: 'condition', field: 'status', operator: 'is', value: 'todo' },
          { kind: 'condition', field: 'status', operator: 'is', value: 'scope' },
        ],
      },
    ],
  });
}

function openColumnsMenu() {
  const trigger = screen.getByRole('button', { name: 'Columns' });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Project list route', () => {
  it('restores sort and column config from the URL on load', async () => {
    stubPointer();
    const tasks = [
      makeTask('t-scope', 'Scope first', 'scope'),
      makeTask('t-todo', 'Todo second', 'todo'),
    ];
    stubListFetch(tasks);

    const { router } = renderListAt(
      `/projects/${projectId}/list?sort=status:asc&columns=label,status`,
    );
    await router.load();

    await waitFor(() => {
      expect(document.querySelector('[data-task-id="t-scope"]')).toBeTruthy();
    });

    const rows = [...document.querySelectorAll('[data-task-list] tbody tr')].map((row) =>
      row.getAttribute('data-task-id'),
    );
    expect(rows).toEqual(['t-scope', 't-todo']);
    expect(document.querySelector('[data-list-column="assignee"]')).toBeNull();
    expect(document.querySelector('[data-list-column="label"]')).toBeTruthy();
    expect(document.querySelector('[data-list-column="status"]')).toBeTruthy();
  });

  it('writes sort and column changes into the URL', async () => {
    stubPointer();
    const tasks = [
      makeTask('t-scope', 'Scope', 'scope'),
      makeTask('t-todo', 'Todo', 'todo'),
      makeTask('t-progress', 'Progress', 'in_progress'),
    ];
    stubListFetch(tasks);

    const { router } = renderListAt(`/projects/${projectId}/list`);
    await router.load();

    await waitFor(() => {
      expect(document.querySelector('[data-task-id="t-scope"]')).toBeTruthy();
    });

    openSortMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add sort level' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Sort field 1')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('Sort field 1'), { target: { value: 'status' } });

    await waitFor(() => {
      const rows = [...document.querySelectorAll('[data-task-list] tbody tr')].map((row) =>
        row.getAttribute('data-task-id'),
      );
      expect(rows).toEqual(['t-scope', 't-todo', 't-progress']);
    });

    openColumnsMenu();
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Assignee' }));

    await waitFor(() => {
      const search = router.state.location.search as {
        sort?: Array<{ field: string; direction: string }>;
        columns?: string[];
      };
      expect(search.sort).toEqual([{ field: 'status', direction: 'asc' }]);
      expect(search.columns).toBeDefined();
      expect(search.columns).not.toContain('assignee');
      expect(document.querySelector('[data-list-column="assignee"]')).toBeNull();
    });
  });

  it('restores a nested filter from the URL on load', async () => {
    stubPointer();
    const tasks = [
      makeTask('full-todo', 'Full todo', 'todo', { lane: 'full' }),
      makeTask('full-scope', 'Full scope', 'scope', { lane: 'full' }),
      makeTask('full-done', 'Full done', 'done', { lane: 'full' }),
      makeTask('auto-todo', 'Auto todo', 'todo', { lane: 'auto' }),
    ];
    stubListFetch(tasks);

    const filter = laneFullTodoOrScopeFilter();
    const { router } = renderListAt(
      `/projects/${projectId}/list?filter=${encodeURIComponent(filter ?? '')}`,
    );
    await router.load();

    await waitFor(() => {
      expect(document.querySelector('[data-task-id="full-todo"]')).toBeTruthy();
      expect(document.querySelector('[data-task-id="full-scope"]')).toBeTruthy();
      expect(document.querySelector('[data-task-id="full-done"]')).toBeNull();
      expect(document.querySelector('[data-task-id="auto-todo"]')).toBeNull();
    });
  });
});
