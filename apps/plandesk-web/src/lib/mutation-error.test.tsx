import { useMutation, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.js';
import { createAppQueryClient } from './query-client.js';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from 'sonner';

function MutateButton({ failWith, withOnError }: { failWith: Error; withOnError?: boolean }) {
  const mutation = useMutation({
    mutationFn: () => {
      throw failWith;
    },
    ...(withOnError
      ? {
          onError: () => {
            // component-owned handler — global toast must skip
          },
        }
      : {}),
  });

  return (
    <button
      type="button"
      onClick={() => {
        mutation.mutate();
      }}
    >
      Run
    </button>
  );
}

function renderWithClient(ui: ReactElement) {
  const client = createAppQueryClient();
  client.setDefaultOptions({ mutations: { retry: false }, queries: { retry: false } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.mocked(toast.error).mockClear();
});

describe('MutationCache global onError (REQ-1)', () => {
  it('toasts a fallback when a mutation has no onError', async () => {
    renderWithClient(<MutateButton failWith={new Error('boom')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.');
    });
  });

  it('toasts a permission message on ApiError 403 without onError', async () => {
    renderWithClient(<MutateButton failWith={new ApiError(403, 'forbidden')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that.");
    });
  });

  it('skips the global toast when the mutation defines onError', async () => {
    renderWithClient(<MutateButton failWith={new Error('boom')} withOnError />);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      // mutation settles; global handler must not fire
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
