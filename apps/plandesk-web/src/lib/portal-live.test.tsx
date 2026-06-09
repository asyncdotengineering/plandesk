import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortalLiveRefetch } from './portal-events.js';

const eventSources: MockEventSource[] = [];

class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    eventSources.push(this);
  }

  close(): void {}
}

function dispatchSse(data: unknown) {
  const source = eventSources[eventSources.length - 1];
  source?.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
}

describe('usePortalLiveRefetch', () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates the portal view query on projection_updated', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        usePortalLiveRefetch('test-token', 'session-abc', true);
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(eventSources).toHaveLength(1);
    });
    expect(eventSources[0]?.url).toContain('/api/portal/v1/shares/test-token/events');

    dispatchSse({ type: 'projection_updated' });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['portal', 'test-token', 'session-abc'],
    });
  });

  it('does not open EventSource before the view has loaded', () => {
    const queryClient = new QueryClient();

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        usePortalLiveRefetch('test-token', 'session-abc', false);
      },
      { wrapper },
    );

    expect(eventSources).toHaveLength(0);
  });

  it('does not open EventSource without a session', () => {
    const queryClient = new QueryClient();

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        usePortalLiveRefetch('test-token', null, true);
      },
      { wrapper },
    );

    expect(eventSources).toHaveLength(0);
  });
});
