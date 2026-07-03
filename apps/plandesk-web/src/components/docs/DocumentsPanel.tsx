import { useState } from 'react';
import type { SerializedDocumentTree, SerializedFolder } from '../../lib/api.js';
import {
  useCreateFolder,
  useDeleteFolder,
  usePatchDocument,
  usePatchFolder,
} from '../../lib/queries.js';

export type DocumentsPanelProps = {
  projectId: string;
  documents: SerializedDocumentTree[];
  folders: SerializedFolder[];
  onOpenDocument: (documentId: string) => void;
};

type FlatDocument = {
  id: string;
  title: string;
  folder_id: string | null;
};

export function flattenDocumentTree(trees: SerializedDocumentTree[]): FlatDocument[] {
  const flat: FlatDocument[] = [];
  function walk(nodes: SerializedDocumentTree[]) {
    for (const node of nodes) {
      flat.push({ id: node.id, title: node.title, folder_id: node.folder_id });
      walk(node.children);
    }
  }
  walk(trees);
  return flat;
}

export function childFoldersOf(
  folders: SerializedFolder[],
  parentFolderId: string | null,
): SerializedFolder[] {
  return folders.filter((folder) => folder.parent_folder_id === parentFolderId);
}

export function isDescendantFolder(
  folders: SerializedFolder[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let current: string | null = candidateId;
  while (current !== null) {
    if (current === ancestorId) {
      return true;
    }
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    current = byId.get(current)?.parent_folder_id ?? null;
  }
  return false;
}

function promptFolderChoice(
  folders: SerializedFolder[],
  message: string,
): string | null | undefined {
  const lines = folders.map((folder, i) => `${String(i + 1)}. ${folder.name}`).join('\n');
  const answer = prompt(`${message}\n0. (root)\n${lines}`);
  if (answer === null || answer.trim() === '') {
    return undefined;
  }
  const index = Number.parseInt(answer.trim(), 10);
  if (Number.isNaN(index) || index < 0 || index > folders.length) {
    return undefined;
  }
  if (index === 0) {
    return null;
  }
  return folders[index - 1]?.id ?? undefined;
}

const actionButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#6b7280',
  fontSize: '0.75rem',
  cursor: 'pointer',
} as const;

export function DocumentsPanel({
  projectId,
  documents,
  folders,
  onOpenDocument,
}: DocumentsPanelProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const createFolder = useCreateFolder(projectId);
  const patchFolder = usePatchFolder();
  const deleteFolder = useDeleteFolder();
  const patchDocument = usePatchDocument();

  const allDocuments = flattenDocumentTree(documents);

  const toggleFolder = (folderId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleNewFolder = (parentFolderId: string | null) => {
    const name = prompt('Folder name');
    if (name === null || name.trim() === '') {
      return;
    }
    createFolder.mutate({ name: name.trim(), parent_folder_id: parentFolderId });
  };

  const handleRenameFolder = (folder: SerializedFolder) => {
    const name = prompt('Folder name', folder.name);
    if (name === null || name.trim() === '' || name.trim() === folder.name) {
      return;
    }
    patchFolder.mutate({ id: folder.id, input: { name: name.trim() } });
  };

  const handleMoveFolder = (folder: SerializedFolder) => {
    const targets = folders.filter(
      (candidate) =>
        candidate.id !== folder.id && !isDescendantFolder(folders, candidate.id, folder.id),
    );
    const choice = promptFolderChoice(targets, `Move "${folder.name}" into which folder?`);
    if (choice === undefined || choice === folder.parent_folder_id) {
      return;
    }
    patchFolder.mutate({ id: folder.id, input: { parent_folder_id: choice } });
  };

  const handleDeleteFolder = (folder: SerializedFolder) => {
    if (
      !confirm(
        `Delete folder "${folder.name}"? Its documents and subfolders move up a level — nothing is orphaned.`,
      )
    ) {
      return;
    }
    deleteFolder.mutate({ id: folder.id, projectId });
  };

  const handleMoveDocument = (doc: FlatDocument) => {
    const choice = promptFolderChoice(folders, `Move "${doc.title}" into which folder?`);
    if (choice === undefined || choice === doc.folder_id) {
      return;
    }
    patchDocument.mutate({ id: doc.id, input: { folder_id: choice } });
  };

  const renderDocument = (doc: FlatDocument, depth: number) => (
    <li
      key={doc.id}
      style={{
        padding: '0.25rem 0',
        paddingLeft: `${String(depth)}rem`,
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'baseline',
      }}
    >
      <button
        type="button"
        onClick={() => {
          onOpenDocument(doc.id);
        }}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
          color: '#1a56db',
          cursor: 'pointer',
        }}
      >
        {doc.title}
      </button>
      <button
        type="button"
        aria-label={`Move document ${doc.title}`}
        onClick={() => {
          handleMoveDocument(doc);
        }}
        style={actionButtonStyle}
      >
        Move
      </button>
    </li>
  );

  const renderFolder = (folder: SerializedFolder, depth: number) => {
    const isCollapsed = collapsed.has(folder.id);
    const childFolders = childFoldersOf(folders, folder.id);
    const childDocuments = allDocuments.filter((doc) => doc.folder_id === folder.id);

    return (
      <li key={folder.id} style={{ padding: '0.25rem 0', paddingLeft: `${String(depth)}rem` }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
          <button
            type="button"
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} folder ${folder.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => {
              toggleFolder(folder.id);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isCollapsed ? '▸' : '▾'} {folder.name}
          </button>
          <button
            type="button"
            aria-label={`New subfolder in ${folder.name}`}
            onClick={() => {
              handleNewFolder(folder.id);
            }}
            style={actionButtonStyle}
          >
            + Folder
          </button>
          <button
            type="button"
            aria-label={`Rename folder ${folder.name}`}
            onClick={() => {
              handleRenameFolder(folder);
            }}
            style={actionButtonStyle}
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Move folder ${folder.name}`}
            onClick={() => {
              handleMoveFolder(folder);
            }}
            style={actionButtonStyle}
          >
            Move
          </button>
          <button
            type="button"
            aria-label={`Delete folder ${folder.name}`}
            onClick={() => {
              handleDeleteFolder(folder);
            }}
            style={{ ...actionButtonStyle, color: '#b91c1c' }}
          >
            Delete
          </button>
        </div>
        {!isCollapsed ? (
          childFolders.length === 0 && childDocuments.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: '0.25rem 0',
                paddingLeft: `${String(depth + 1)}rem`,
                color: '#9ca3af',
                fontSize: '0.875rem',
              }}
            >
              Empty folder
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {childFolders.map((child) => renderFolder(child, depth + 1))}
              {childDocuments.map((doc) => renderDocument(doc, depth + 1))}
            </ul>
          )
        ) : null}
      </li>
    );
  };

  const rootFolders = childFoldersOf(folders, null);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const rootDocuments = allDocuments.filter(
    (doc) => doc.folder_id === null || !folderIds.has(doc.folder_id),
  );

  return (
    <section aria-label="Documents panel">
      <div
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}
      >
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Documents</h2>
        <button
          type="button"
          onClick={() => {
            handleNewFolder(null);
          }}
          disabled={createFolder.isPending}
          style={{ ...actionButtonStyle, color: '#1a56db', fontWeight: 600 }}
        >
          + New folder
        </button>
      </div>
      {rootFolders.length === 0 && rootDocuments.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No documents yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.5rem' }}>
          {rootFolders.map((folder) => renderFolder(folder, 0))}
          {rootDocuments.map((doc) => renderDocument(doc, 0))}
        </ul>
      )}
    </section>
  );
}
