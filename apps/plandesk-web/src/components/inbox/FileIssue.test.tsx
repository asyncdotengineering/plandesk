import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileIssue } from './FileIssue.js';

function renderFileIssue() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FileIssue projectId="proj-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FileIssue', () => {
  it('creates a backlog task from the title, description, and severity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          id: 'task-1',
          project_id: 'proj-1',
          label: 'Login button is unresponsive',
          status: 'backlog',
          description: 'Tapping it does nothing.\n\nSeverity: high',
          x: 0,
          y: 0,
          assignee: null,
          due_date: null,
          created_at: '2026-07-04T12:00:00.000Z',
          updated_at: '2026-07-04T12:00:00.000Z',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderFileIssue();

    fireEvent.click(screen.getByRole('button', { name: 'File an issue' }));

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Login button is unresponsive' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Tapping it does nothing.' },
    });
    fireEvent.change(screen.getByLabelText(/Severity/), { target: { value: 'high' } });

    fireEvent.click(screen.getByRole('button', { name: 'File issue' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/proj-1/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            label: 'Login button is unresponsive',
            description: 'Tapping it does nothing.\n\nSeverity: high',
            status: 'backlog',
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Filed ✓')).toBeTruthy();
    });
  });

  it('requires a title before the submit button is enabled', () => {
    renderFileIssue();

    fireEvent.click(screen.getByRole('button', { name: 'File an issue' }));

    expect(screen.getByRole('button', { name: 'File issue' })).toHaveProperty('disabled', true);
  });
});
