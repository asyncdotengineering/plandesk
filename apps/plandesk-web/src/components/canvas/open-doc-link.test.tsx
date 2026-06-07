import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenDocLink } from './OpenDocLink.js';

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close(): void {}
}

function renderOpenDocLink(projectId: string, documentId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const rootRoute = createRootRoute({
    component: () => <OpenDocLink projectId={projectId} documentId={documentId} />,
  });

  const router = createRouter({ routeTree: rootRoute });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenDocLink', () => {
  it('navigates to the linked document editor in one click', async () => {
    renderOpenDocLink('proj-1', 'doc-1');

    const link = await screen.findByRole('link', { name: 'Open doc →' });
    expect(link.getAttribute('href')).toBe('/projects/proj-1/documents/doc-1');
  });
});
