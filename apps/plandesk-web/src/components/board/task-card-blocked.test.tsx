import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedTask } from '../../lib/api.js';
import { Board } from './Board.js';

const projectId = 'proj-1';

function makeTask(id: string, label: string, status: SerializedTask['status']): SerializedTask {
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
    tags: [],
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

describe('TaskCard blocked indicator', () => {
  it('renders a blocked indicator only when task.blocked is true', async () => {
    const blocked: SerializedTask = {
      ...makeTask('t-blocked', 'Waiting card', 'todo'),
      blocked: true,
      waiting_on: ['prereq-1'],
    };
    const clear = makeTask('t-clear', 'Ready card', 'todo');

    const { container } = await renderBoard([blocked, clear]);

    await waitFor(() => {
      expect(screen.getByText('Waiting card')).toBeTruthy();
      expect(screen.getByText('Ready card')).toBeTruthy();
    });

    const blockedCard = container.querySelector('[data-task-id="t-blocked"]');
    const clearCard = container.querySelector('[data-task-id="t-clear"]');
    expect(blockedCard?.querySelector('[data-blocked]')).toBeTruthy();
    expect(blockedCard?.textContent).toContain('Blocked');
    expect(clearCard?.querySelector('[data-blocked]')).toBeNull();
  });
});
