import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalsPanel } from './GoalsPanel.js';

const projectId = 'proj-1';

const goalActive = {
  id: 'goal-1',
  project_id: projectId,
  objective: 'Ship goals UI',
  status: 'active' as const,
  verification_surface: null,
  constraints: null,
  boundaries: null,
  iteration_policy: null,
  stop_condition: null,
  budget: null,
  last_verification: { at: '2026-07-04T12:00:00.000Z', green: true, kind: null },
  created_at: '2026-07-04T10:00:00.000Z',
  updated_at: '2026-07-04T12:00:00.000Z',
};

const goalFailed = {
  ...goalActive,
  id: 'goal-2',
  objective: 'Run gate checks',
  verification_surface: JSON.stringify({ kind: 'gate_command', command: 'pnpm test' }),
  last_verification: {
    at: '2026-07-04T13:00:00.000Z',
    green: false,
    kind: 'gate_command',
    detail: 'exit 1',
  },
};

const cycleTask = {
  id: 'task-1',
  project_id: projectId,
  goal_id: 'goal-1',
  label: 'Implement panel',
  status: 'in_progress' as const,
  description: null,
  x: 0,
  y: 0,
  assignee: null,
  due_date: null,
  created_at: '2026-07-04T10:00:00.000Z',
  updated_at: '2026-07-04T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
}

function renderGoalsPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <GoalsPanel projectId={projectId} />,
  });
  const router = createRouter({ routeTree: rootRoute });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function routeFetch(url: string) {
  if (url.endsWith(`/projects/${projectId}/goals`)) {
    return jsonResponse([goalActive, goalFailed]);
  }
  if (url.endsWith('/goals/goal-1')) {
    return jsonResponse({ ...goalActive, cycle_tasks: [cycleTask] });
  }
  if (url.endsWith('/goals/goal-2')) {
    return jsonResponse({ ...goalFailed, cycle_tasks: [] });
  }
  throw new Error(`unexpected fetch: ${url}`);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GoalsPanel', () => {
  it('renders goals with status and acceptance indicators', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch));
    renderGoalsPanel();

    await waitFor(() => {
      expect(screen.getByText('Ship goals UI')).toBeTruthy();
      expect(screen.getByText('Run gate checks')).toBeTruthy();
    });

    expect(screen.getAllByLabelText('acceptance passed').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('acceptance failed').length).toBeGreaterThan(0);
  });

  it('renders cycle tasks and acceptance status in goal detail', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch));
    renderGoalsPanel();

    await waitFor(() => {
      expect(screen.getByText('Implement panel')).toBeTruthy();
    });
    expect(screen.getByText(/Passed/)).toBeTruthy();
  });
});
