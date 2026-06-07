import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SerializedAgentRun } from '../../lib/api.js';
import { AgentRunsPanel } from './AgentRunsPanel.js';

const projectId = 'proj-1';

const sampleRuns: SerializedAgentRun[] = [
  {
    id: 'run-2',
    project_id: projectId,
    status: 'running',
    label: 'Codex worker',
    started_at: '2026-06-08T12:00:00.000Z',
    completed_at: null,
    events: [{ id: 'evt-1', message: 'Reading canvas', created_at: '2026-06-08T12:00:01.000Z' }],
  },
  {
    id: 'run-1',
    project_id: projectId,
    status: 'completed',
    label: 'Claude worker',
    started_at: '2026-06-08T11:00:00.000Z',
    completed_at: '2026-06-08T11:05:00.000Z',
    events: [{ id: 'evt-2', message: 'Done', created_at: '2026-06-08T11:04:00.000Z' }],
  },
];

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentRunsPanel projectId={projectId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(sampleRuns),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentRunsPanel', () => {
  it('renders runs with status and progress events', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Agents activity')).toBeTruthy();
      expect(screen.getByText('Codex worker')).toBeTruthy();
      expect(screen.getByText('Claude worker')).toBeTruthy();
      expect(screen.getByText('Reading canvas')).toBeTruthy();
      expect(screen.getByText('Done')).toBeTruthy();
    });

    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/v1/projects/proj-1/agent-runs', expect.any(Object));
  });
});
