import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createRootRoute,
  createRouter,
  createMemoryHistory,
} from '@tanstack/react-router';
import { DocumentsPanel } from './DocumentsPanel.js';
import type { SerializedArtifactSummary, SerializedFolder } from '../../lib/api.js';

const projectId = 'proj-1';

afterEach(cleanup);

function makeArtifact(
  id: string,
  title: string,
  overrides: Partial<SerializedArtifactSummary> = {},
): SerializedArtifactSummary {
  return {
    id,
    title,
    kind: 'html',
    folder_id: null,
    prototype_id: null,
    revision_id: 'rev-1',
    updated_at: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

const FOLDER: SerializedFolder = {
  id: 'folder-1',
  project_id: projectId,
  name: 'Reports',
  parent_folder_id: null,
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
};

async function renderPanel(artifacts: SerializedArtifactSummary[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <DocumentsPanel
        projectId={projectId}
        documents={[]}
        folders={[FOLDER]}
        artifacts={artifacts}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findAllByText('Documents');
}

describe('DocumentsPanel artifacts', () => {
  it('lists a filed artifact and links it to the artifact view', async () => {
    await renderPanel([makeArtifact('art-1', 'Q3 Report', { folder_id: FOLDER.id })]);

    const link = screen.getByRole('link', { name: /Q3 Report/ });
    expect(link.getAttribute('href')).toBe(`/projects/${projectId}/artifacts/art-1`);
  });

  it('marks a page so it reads as different from a document before opening', async () => {
    await renderPanel([makeArtifact('art-1', 'Q3 Report', { folder_id: FOLDER.id })]);

    // Without a marker, a rendered page and a rich-text document are
    // indistinguishable in the tree until you click one.
    expect(screen.getByTestId('artifact-row-art-1').textContent).toContain('Page');
  });

  it('leaves prototype screens out — they belong to the canvas', async () => {
    await renderPanel([
      makeArtifact('art-1', 'Filed Report', { folder_id: FOLDER.id }),
      makeArtifact('art-2', 'Checkout Screen', { prototype_id: 'proto-1' }),
    ]);

    expect(screen.queryByText('Checkout Screen')).toBeNull();
    expect(screen.getByText('Filed Report')).toBeTruthy();
  });

  it('shows nothing when the project has no filed artifacts', async () => {
    await renderPanel([makeArtifact('art-2', 'Checkout Screen', { prototype_id: 'proto-1' })]);

    expect(screen.queryByTestId('filed-artifacts')).toBeNull();
  });
});
