import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    linked_task_id: null,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
    children,
  };
}

function renderPanel(
  documents: SerializedDocumentTree[],
  folders: SerializedFolder[],
  onOpenDocument = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentsPanel
        projectId={projectId}
        documents={documents}
        folders={folders}
        onOpenDocument={onOpenDocument}
      />
    </QueryClientProvider>,
  );
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
  it('renders nested folders with their documents and root documents', () => {
    const folders = [makeFolder('f1', 'Specs', null), makeFolder('f2', 'Archive', 'f1')];
    const documents = [
      makeDocument('d1', 'Root doc', null),
      makeDocument('d2', 'Spec doc', 'f1'),
      makeDocument('d3', 'Old doc', 'f2'),
    ];

    renderPanel(documents, folders);

    expect(screen.getByText(/Specs/)).toBeTruthy();
    expect(screen.getByText(/Archive/)).toBeTruthy();
    expect(screen.getByText('Root doc')).toBeTruthy();
    expect(screen.getByText('Spec doc')).toBeTruthy();
    expect(screen.getByText('Old doc')).toBeTruthy();
  });

  it('collapses and expands a folder', () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const documents = [makeDocument('d1', 'Spec doc', 'f1')];

    renderPanel(documents, folders);
    expect(screen.getByText('Spec doc')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Collapse folder Specs'));
    expect(screen.queryByText('Spec doc')).toBeNull();

    fireEvent.click(screen.getByLabelText('Expand folder Specs'));
    expect(screen.getByText('Spec doc')).toBeTruthy();
  });

  it('renders an empty folder state', () => {
    renderPanel([], [makeFolder('f1', 'Empty one', null)]);
    expect(screen.getByText('Empty folder')).toBeTruthy();
  });

  it('renders empty panel state with no folders and no documents', () => {
    renderPanel([], []);
    expect(screen.getByText('No documents yet.')).toBeTruthy();
  });

  it('creates a root folder via prompt and POST', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('New folder name'));

    renderPanel([], []);
    fireEvent.click(screen.getByText('+ New folder'));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall?.[0]).toBe(`/api/v1/projects/${projectId}/folders`);
      const rawBody = postCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<
        string,
        unknown
      >;
      expect(body.name).toBe('New folder name');
      expect(body.parent_folder_id).toBeNull();
    });
  });

  it('creates a nested subfolder with parent_folder_id', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Nested'));

    renderPanel([], [makeFolder('f1', 'Specs', null)]);
    fireEvent.click(screen.getByLabelText('New subfolder in Specs'));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeTruthy();
      const rawBody = postCall?.[1]?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<
        string,
        unknown
      >;
      expect(body.parent_folder_id).toBe('f1');
    });
  });

  it('renames a folder via PATCH', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Renamed'));

    renderPanel([], [makeFolder('f1', 'Specs', null)]);
    fireEvent.click(screen.getByLabelText('Rename folder Specs'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall?.[0]).toBe('/api/v1/folders/f1');
      const rawBody = patchCall?.[1]?.body;
      expect(rawBody).toBe(JSON.stringify({ name: 'Renamed' }));
    });
  });

  it('moves a folder into another folder via PATCH', async () => {
    // choice "1" selects the first eligible target folder
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('1'));

    renderPanel([], [makeFolder('f1', 'Specs', null), makeFolder('f2', 'Archive', null)]);
    fireEvent.click(screen.getByLabelText('Move folder Archive'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall?.[0]).toBe('/api/v1/folders/f2');
      expect(patchCall?.[1]?.body).toBe(JSON.stringify({ parent_folder_id: 'f1' }));
    });
  });

  it('moves a document into a folder via PATCH with folder_id', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('1'));

    renderPanel([makeDocument('d1', 'Loose doc', null)], [makeFolder('f1', 'Specs', null)]);
    fireEvent.click(screen.getByLabelText('Move document Loose doc'));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall?.[0]).toBe('/api/v1/documents/d1');
      expect(patchCall?.[1]?.body).toBe(JSON.stringify({ folder_id: 'f1' }));
    });
  });

  it('deletes a folder after confirm via DELETE', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    renderPanel([], [makeFolder('f1', 'Specs', null)]);
    fireEvent.click(screen.getByLabelText('Delete folder Specs'));

    await waitFor(() => {
      const deleteCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall?.[0]).toBe('/api/v1/folders/f1');
    });
  });

  it('opens a document through the onOpenDocument callback', () => {
    const onOpenDocument = vi.fn();
    renderPanel([makeDocument('d1', 'Spec doc', null)], [], onOpenDocument);

    fireEvent.click(screen.getByText('Spec doc'));
    expect(onOpenDocument).toHaveBeenCalledWith('d1');
  });
});
