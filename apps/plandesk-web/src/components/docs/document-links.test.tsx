import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SerializedDocument, SerializedEntityLink } from '../../lib/api.js';
import { DocumentLinks } from './DocumentLinks.js';

const projectId = 'proj-1';

function makeLink(
  type: SerializedEntityLink['type'],
  id: string,
  title: string,
): SerializedEntityLink {
  return { type, id, title, label: 'documents', edge_id: `edge-${id}` };
}

function makeDocument(links: SerializedEntityLink[]): SerializedDocument {
  return {
    id: 'doc-1',
    project_id: projectId,
    title: 'Spec',
    body: null,
    status_line: null,
    parent_id: null,
    folder_id: null,
    links,
    backlinks: [],
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  };
}

function renderLinks(document: SerializedDocument) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <DocumentLinks projectId={projectId} document={document} editable={false} />
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('DocumentLinks task links', () => {
  // The link pointed at /projects/$id/board with no reference to the task at
  // all, so clicking a task in a document's link list landed on the board and
  // opened nothing. Reported from a real board.
  it('links a task to the board with the task in the URL', async () => {
    renderLinks(makeDocument([makeLink('task', 'task-abc', 'CR001-WI3: API — skincare hero fetch')]));

    const link = await waitFor(() =>
      screen.getByRole('link', { name: /CR001-WI3: API/ }),
    );
    const href = link.getAttribute('href') ?? '';

    expect(href).toContain(`/projects/${projectId}/board`);
    expect(href).toContain('task-abc');
  });

  it('still links a document to its own page', async () => {
    renderLinks(makeDocument([makeLink('document', 'doc-2', 'Related spec')]));

    const link = await waitFor(() => screen.getByRole('link', { name: /Related spec/ }));
    expect(link.getAttribute('href') ?? '').toContain(`/projects/${projectId}/documents/doc-2`);
  });
});
