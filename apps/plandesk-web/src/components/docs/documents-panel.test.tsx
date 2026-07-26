import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedDocumentTree, SerializedFolder } from '../../lib/api.js';
import {
  DocumentsPanel,
  childFoldersOf,
  flattenDocumentTree,
  isDescendantFolder,
} from './DocumentsPanel.js';

const projectId = 'proj-1';

function makeFolder(id: string, name: string, parentFolderId: string | null): SerializedFolder {
  return {
    id,
    project_id: projectId,
    name,
    parent_folder_id: parentFolderId,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
  };
}

function makeDocument(
  id: string,
  title: string,
  folderId: string | null,
  children: SerializedDocumentTree[] = [],
): SerializedDocumentTree {
  return {
    id,
    project_id: projectId,
    title,
    body: null,
    status_line: null,
    parent_id: null,
    folder_id: folderId,
    links: [],
    backlinks: [],
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
    children,
  };
}

function renderPanel(documents: SerializedDocumentTree[], folders: SerializedFolder[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <DocumentsPanel projectId={projectId} documents={documents} folders={folders} />
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// Radix DropdownMenu/Select open on pointer events; jsdom needs these polyfills.
function stubPointer() {
  const el = window.Element.prototype as unknown as Record<string, () => unknown>;
  el.hasPointerCapture = () => false;
  el.setPointerCapture = () => undefined;
  el.releasePointerCapture = () => undefined;
  el.scrollIntoView = () => undefined;
}

function openKebab(accessibleName: string) {
  const trigger = screen.getByRole('button', { name: accessibleName });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0 });
}

// TanStack RouterProvider hydrates async; wait for the breadcrumb root before querying.
function panelReady() {
  return screen.findByRole('button', { name: 'Documents' });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    }),
  );
  stubPointer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('panel helpers', () => {
  it('flattenDocumentTree includes nested children with their folder ids', () => {
    const tree = [
      makeDocument('d1', 'Parent', 'f1', [makeDocument('d2', 'Child', 'f2')]),
      makeDocument('d3', 'Root doc', null),
    ];
    const flat = flattenDocumentTree(tree);
    expect(flat.map((doc) => doc.id)).toEqual(['d1', 'd2', 'd3']);
    expect(flat[1]?.folder_id).toBe('f2');
  });

  it('childFoldersOf filters by parent', () => {
    const folders = [makeFolder('f1', 'A', null), makeFolder('f2', 'B', 'f1')];
    expect(childFoldersOf(folders, null).map((folder) => folder.id)).toEqual(['f1']);
    expect(childFoldersOf(folders, 'f1').map((folder) => folder.id)).toEqual(['f2']);
  });

  it('isDescendantFolder walks the parent chain', () => {
    const folders = [
      makeFolder('f1', 'A', null),
      makeFolder('f2', 'B', 'f1'),
      makeFolder('f3', 'C', 'f2'),
    ];
    expect(isDescendantFolder(folders, 'f3', 'f1')).toBe(true);
    expect(isDescendantFolder(folders, 'f1', 'f3')).toBe(false);
  });
});

describe('DocumentsPanel', () => {
  it('shows root folders as cards with a document count and lists ALL documents at the root (flat, including folder docs)', async () => {
    const folders = [makeFolder('f1', 'Specs', null), makeFolder('f2', 'Archive', 'f1')];
    const documents = [makeDocument('d1', 'Root doc', null), makeDocument('d2', 'Spec doc', 'f1')];

    renderPanel(documents, folders);
    await panelReady();

    // Root folder is shown as a card; nested folder is not surfaced at root.
    expect(screen.getByText('Specs')).toBeTruthy();
    expect(screen.queryByText('Archive')).toBeNull();
    // Specs has exactly one document directly inside it.
    expect(screen.getByText(/1 document/)).toBeTruthy();
    // The root-level document appears in the list.
    expect(screen.getAllByText('Root doc').length).toBeGreaterThan(0);
    // "All documents" is genuinely flat: the document inside the Specs folder
    // ALSO appears at the root alongside the loose root doc.
    expect(screen.getAllByText('Spec doc').length).toBeGreaterThan(0);
  });

  it('shows every document at the root even when every doc lives inside a folder', async () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'In-folder doc', 'f1')];

    renderPanel(documents, folders);
    await panelReady();

    // No loose root docs — but "All documents" still surfaces the folder doc.
    expect(screen.getAllByText('In-folder doc').length).toBeGreaterThan(0);
  });

  it('drills into a folder to reveal its documents', async () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'Spec doc', 'f1')];

    renderPanel(documents, folders);
    await panelReady();

    fireEvent.click(screen.getByRole('button', { name: 'Open folder Specs' }));

    // Breadcrumb now shows the folder, and its document is listed.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Specs' })).toBeTruthy();
    });
    expect(screen.getAllByText('Spec doc').length).toBeGreaterThan(0);
  });

  it('shows an empty state when a drilled-into folder has no documents', async () => {
    renderPanel([], [makeFolder('f1', 'Empty one', null)]);
    await panelReady();

    fireEvent.click(screen.getByRole('button', { name: 'Open folder Empty one' }));
    expect(await screen.findByText('This folder is empty.')).toBeTruthy();
  });

  it('renders empty root state with no folders and no documents', async () => {
    renderPanel([], []);
    await panelReady();
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
  });

  it('creates a root folder via the dialog and POST', async () => {
    renderPanel([], []);
    await panelReady();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(await screen.findByLabelText('Folder name'), {
      target: { value: 'New folder name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall?.[0]).toBe(`/api/v1/projects/${projectId}/folders`);
      const rawBody = postCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<string, unknown>;
      expect(body.name).toBe('New folder name');
      expect(body.parent_folder_id).toBeNull();
    });
  });

  it('creates a document via the dialog and POST', async () => {
    renderPanel([], []);
    await panelReady();

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Design: caching' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall?.[0]).toBe(`/api/v1/projects/${projectId}/documents`);
      const rawBody = postCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<string, unknown>;
      expect(body.title).toBe('Design: caching');
      expect(body.folder_id).toBeNull();
    });
  });

  it('renames a folder via the dialog and PATCH', async () => {
    renderPanel([], [makeFolder('f1', 'Specs', null)]);
    await panelReady();

    openKebab('Actions for folder Specs');
    fireEvent.click(screen.getByText('Rename'));
    fireEvent.change(await screen.findByLabelText('Folder name'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall?.[0]).toBe('/api/v1/folders/f1');
      expect(patchCall?.[1]?.body).toBe(JSON.stringify({ name: 'Renamed' }));
    });
  });

  it('opens a move dialog for a document', async () => {
    renderPanel([makeDocument('d1', 'Loose doc', null)], [makeFolder('f1', 'Specs', null)]);
    await panelReady();

    openKebab('Actions for document Loose doc');
    fireEvent.click(screen.getByText('Move…'));
    expect(await screen.findByText('Move "Loose doc"')).toBeTruthy();
  });

  it('deletes a folder via a confirm dialog then DELETE', async () => {
    renderPanel([], [makeFolder('f1', 'Specs', null)]);
    await panelReady();

    openKebab('Actions for folder Specs');
    fireEvent.click(screen.getByText('Delete'));
    // The only button named "Delete" is the confirm dialog's action.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall?.[0]).toBe('/api/v1/folders/f1');
    });
  });

  it('renders a document row as a link to the document route', async () => {
    renderPanel([makeDocument('d1', 'Spec doc', null)], []);
    const links = await screen.findAllByRole('link', { name: 'Spec doc' });
    expect(links[0]?.getAttribute('href')).toBe(`/projects/${projectId}/documents/d1`);
  });
});
