import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerializedGoalDetail } from '../../lib/api.js';
import { GoalDetail } from './GoalDetail.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const projectId = 'proj-1';

const humanSignOffGoal: SerializedGoalDetail = {
  id: 'goal-hso',
  project_id: projectId,
  name: 'approval',
  objective: 'Get approval',
  status: 'active',
  verification_surface: JSON.stringify({ kind: 'human_sign_off' }),
  constraints: null,
  boundaries: null,
  iteration_policy: null,
  stop_condition: null,
  budget: null,
  last_verification: null,
  created_at: '2026-07-04T10:00:00.000Z',
  updated_at: '2026-07-04T10:00:00.000Z',
  cycle_tasks: [],
};

const gateCommandGoal: SerializedGoalDetail = {
  ...humanSignOffGoal,
  id: 'goal-gate',
  objective: 'Pass CI gate',
  verification_surface: JSON.stringify({ kind: 'gate_command', command: 'pnpm test' }),
  last_verification: {
    at: '2026-07-04T11:00:00.000Z',
    green: false,
    kind: 'gate_command',
    detail: 'exit 1',
  },
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
}

function renderGoalDetail(goal: SerializedGoalDetail) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GoalDetail projectId={projectId} goal={goal} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GoalDetail', () => {
  it('human_sign_off complete button calls complete mutation with evidence', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.match(/\/goals\/goal-hso\/complete$/) && init?.method === 'POST') {
        if (typeof init.body !== 'string') {
          throw new Error('expected string request body');
        }
        const body = JSON.parse(init.body) as {
          evidence: { kind: string; approved_by: string };
        };
        expect(body.evidence).toEqual({ kind: 'human_sign_off', approved_by: 'Alice' });
        return jsonResponse({ ...humanSignOffGoal, status: 'complete' });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGoalDetail(humanSignOffGoal);

    expect(screen.getByRole('heading', { name: 'approval' })).toBeTruthy();
    expect(screen.getByText('Get approval')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Sign off & complete/i }));

    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(/Approver name/i);
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Sign off & complete/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it('gate_command goal shows no complete button', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderGoalDetail(gateCommandGoal);

    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
    expect(screen.getByText(/Failed/)).toBeTruthy();
  });

  it('renders cycle tasks with status chips', () => {
    vi.stubGlobal('fetch', vi.fn());
    const goalWithTasks: SerializedGoalDetail = {
      ...humanSignOffGoal,
      cycle_tasks: [
        {
          id: 'task-1',
          project_id: projectId,
          goal_id: humanSignOffGoal.id,
          label: 'Write tests',
          status: 'todo',
          priority: 'medium',
          description: null,
          x: 0,
          y: 0,
          assignee: null,
          due_date: null,
          commit_refs: [],
          created_at: '2026-07-04T10:00:00.000Z',
          updated_at: '2026-07-04T10:00:00.000Z',
        },
      ],
    };
    renderGoalDetail(goalWithTasks);

    expect(screen.getByText('Write tests')).toBeTruthy();
    expect(screen.getByText('Todo')).toBeTruthy();
  });
});
