import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedDocumentTree, SerializedFolder } from '../../lib/api.js';
import {
  DocumentsPanel,
  DOCUMENT_DRAG_MIME,
  UNFILED_FOLDER_KEY,
  childFoldersOf,
  directDocumentCount,
  flattenDocumentTree,
  folderExpandStorageKey,
  isDescendantFolder,
  loadExpandedFolderIds,
  saveExpandedFolderIds,
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

function panelReady() {
  return screen.findByRole('heading', { name: 'Documents' });
}

beforeEach(() => {
  localStorage.clear();
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
  localStorage.clear();
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

  it('directDocumentCount counts only documents with that folder_id', () => {
    const docs = flattenDocumentTree([
      makeDocument('d1', 'A', 'f1'),
      makeDocument('d2', 'B', 'f1'),
      makeDocument('d3', 'C', 'f2'),
      makeDocument('d4', 'D', null),
    ]);
    expect(directDocumentCount(docs, 'f1')).toBe(2);
    expect(directDocumentCount(docs, null)).toBe(1);
  });
});

describe('DocumentsPanel folder tree', () => {
  it('renders each document exactly once — filed under its folder, loose under Unfiled', async () => {
    const folders = [makeFolder('f1', 'Specs', null), makeFolder('f2', 'Archive', 'f1')];
    const documents = [
      makeDocument('d1', 'Root doc', null),
      makeDocument('d2', 'Spec doc', 'f1'),
      makeDocument('d3', 'Archive doc', 'f2'),
    ];

    renderPanel(documents, folders);
    await panelReady();

    const tree = screen.getByRole('list', { name: 'Folder tree' });
    expect(within(tree).getByText('Specs')).toBeTruthy();
    expect(within(tree).getByText('Archive')).toBeTruthy();
    expect(within(tree).getByText('Unfiled')).toBeTruthy();

    // Spec doc only under Specs — not duplicated at the root / Unfiled.
    expect(within(tree).getAllByText('Spec doc')).toHaveLength(1);
    expect(within(tree).getAllByText('Archive doc')).toHaveLength(1);
    expect(within(tree).getAllByText('Root doc')).toHaveLength(1);

    // Direct counts only (Archive's doc is not rolled into Specs).
    expect(screen.getByTestId('doc-count-f1').textContent).toBe('1');
    expect(screen.getByTestId('doc-count-f2').textContent).toBe('1');
    expect(screen.getByTestId('doc-count-unfiled').textContent).toBe('1');
  });

  it('shows empty-folder copy when an expanded folder has no children', async () => {
    renderPanel([], [makeFolder('f1', 'Empty one', null)]);
    await panelReady();
    expect(screen.getByText('This folder is empty.')).toBeTruthy();
  });

  it('renders empty workspace state with no folders and no documents', async () => {
    renderPanel([], []);
    await panelReady();
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Folder tree' })).toBeNull();
  });

  it('collapses a folder and persists expand state across remount', async () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'Spec doc', 'f1')];

    const first = renderPanel(documents, folders);
    await panelReady();
    const tree = () => screen.getByRole('list', { name: 'Folder tree' });
    expect(within(tree()).getByText('Spec doc')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse folder Specs' }));
    expect(within(tree()).queryByText('Spec doc')).toBeNull();

    const stored = loadExpandedFolderIds(projectId);
    expect(stored?.has('f1')).toBe(false);
    expect(localStorage.getItem(folderExpandStorageKey(projectId))).toBeTruthy();

    first.unmount();
    cleanup();

    renderPanel(documents, folders);
    await panelReady();
    // Remount restores collapsed Specs — doc stays hidden in the tree until expand.
    expect(within(tree()).queryByText('Spec doc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder Specs' }));
    expect(within(tree()).getByText('Spec doc')).toBeTruthy();
  });

  it('saveExpandedFolderIds round-trips through localStorage', () => {
    saveExpandedFolderIds(projectId, new Set([UNFILED_FOLDER_KEY, 'f1']));
    expect(loadExpandedFolderIds(projectId)).toEqual(new Set([UNFILED_FOLDER_KEY, 'f1']));
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

  it('creates a document via the dialog into a chosen folder in one POST', async () => {
    renderPanel([], [makeFolder('f1', 'Specs', null)]);
    await panelReady();

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Design: caching' },
    });
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'f1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall?.[0]).toBe(`/api/v1/projects/${projectId}/documents`);
      const rawBody = postCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<string, unknown>;
      expect(body.title).toBe('Design: caching');
      expect(body.folder_id).toBe('f1');
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

describe('DocumentsPanel drag and drop', () => {
  function makeDataTransfer(initial: Record<string, string> = {}) {
    const store = { ...initial };
    return {
      store,
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? '',
      get types() {
        return Object.keys(store);
      },
      effectAllowed: 'all' as string,
      dropEffect: 'none' as string,
    };
  }

  it('dragging a document onto a folder PATCHes folder_id and updates counts', async () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'Loose doc', null)];
    renderPanel(documents, folders);
    await panelReady();

    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getByTestId('document-row-d1'), { dataTransfer: dt });
    expect(dt.store[DOCUMENT_DRAG_MIME]).toBe('d1');

    fireEvent.dragOver(screen.getByTestId('folder-drop-f1'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('folder-drop-f1'), { dataTransfer: dt });

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall?.[0]).toBe('/api/v1/documents/d1');
      expect(patchCall?.[1]?.body).toBe(JSON.stringify({ folder_id: 'f1' }));
    });

    // Optimistic: doc moves under Specs and counts flip before refetch.
    const tree = screen.getByRole('list', { name: 'Folder tree' });
    expect(within(tree).getByText('Loose doc')).toBeTruthy();
    expect(screen.getByTestId('doc-count-f1').textContent).toBe('1');
    expect(screen.getByTestId('doc-count-unfiled').textContent).toBe('0');
  });

  it('dragging onto Unfiled clears folder_id', async () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'Spec doc', 'f1')];
    renderPanel(documents, folders);
    await panelReady();

    const dt = makeDataTransfer({ [DOCUMENT_DRAG_MIME]: 'd1' });
    fireEvent.drop(screen.getByTestId('folder-drop-unfiled'), { dataTransfer: dt });

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall?.[1]?.body).toBe(JSON.stringify({ folder_id: null }));
    });
    expect(screen.getByTestId('doc-count-unfiled').textContent).toBe('1');
    expect(screen.getByTestId('doc-count-f1').textContent).toBe('0');
  });

  it('rolls back and toasts when the server rejects the move', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'boom' }),
      text: () => Promise.resolve('boom'),
    } as Response);

    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'Loose doc', null)];
    renderPanel(documents, folders);
    await panelReady();

    const dt = makeDataTransfer({ [DOCUMENT_DRAG_MIME]: 'd1' });
    fireEvent.drop(screen.getByTestId('folder-drop-f1'), { dataTransfer: dt });

    await waitFor(() => {
      expect(screen.getByTestId('doc-count-unfiled').textContent).toBe('1');
      expect(screen.getByTestId('doc-count-f1').textContent).toBe('0');
    });
  });

  it('dropping outside a folder target does not PATCH', async () => {
    renderPanel([makeDocument('d1', 'Loose doc', null)], [makeFolder('f1', 'Specs', null)]);
    await panelReady();

    const dt = makeDataTransfer({ [DOCUMENT_DRAG_MIME]: 'd1' });
    fireEvent.drop(screen.getByRole('heading', { name: 'Documents' }), { dataTransfer: dt });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('keyboard Move dialog performs the same folder_id PATCH', async () => {
    renderPanel([makeDocument('d1', 'Loose doc', null)], [makeFolder('f1', 'Specs', null)]);
    await panelReady();

    openKebab('Actions for document Loose doc');
    fireEvent.click(screen.getByText('Move…'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Move "Loose doc"')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Destination'), {
      target: { value: 'f1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall?.[0]).toBe('/api/v1/documents/d1');
      expect(patchCall?.[1]?.body).toBe(JSON.stringify({ folder_id: 'f1' }));
    });
  });
});

describe('DocumentsPanel multi-select', () => {
  it('selects a range with shift-click and moves all via Move to folder', async () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [
      makeDocument('d1', 'Alpha', null),
      makeDocument('d2', 'Beta', null),
      makeDocument('d3', 'Gamma', null),
    ];
    renderPanel(documents, folders);
    await panelReady();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Gamma' }), { shiftKey: true });

    expect(screen.getByTestId('selection-bar').textContent).toMatch(/3 selected/);

    // Collapse Unfiled — selection bar stays.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Unfiled' }));
    expect(screen.getByTestId('selection-bar').textContent).toMatch(/3 selected/);

    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Destination'), {
      target: { value: 'f1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      const patches = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patches).toHaveLength(3);
      expect(patches.every(([, init]) => init?.body === JSON.stringify({ folder_id: 'f1' }))).toBe(
        true,
      );
    });
    expect(screen.getByTestId('doc-count-f1').textContent).toBe('3');
  });

  it('Clear empties the selection affordance', async () => {
    renderPanel([makeDocument('d1', 'Alpha', null)], []);
    await panelReady();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    expect(screen.getByTestId('selection-bar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
