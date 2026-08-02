import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreVerticalIcon,
} from 'lucide-react';
import type {
  SerializedDocumentTree,
  SerializedEntityLink,
  SerializedFolder,
  SerializedTask,
} from '../../lib/api.js';
import {
  useCreateDocument,
  useCreateEdge,
  useCreateFolder,
  useDeleteDocument,
  useDeleteFolder,
  usePatchDocument,
  usePatchFolder,
} from '../../lib/queries.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from './ConfirmDialog.js';

export type DocumentsPanelProps = {
  projectId: string;
  documents: SerializedDocumentTree[];
  folders: SerializedFolder[];
  tasks?: SerializedTask[];
};

type FlatDocument = {
  id: string;
  title: string;
  folder_id: string | null;
  status_line: string | null;
  links: SerializedEntityLink[];
  project_id: string;
  updated_at: string;
};

export function flattenDocumentTree(trees: SerializedDocumentTree[]): FlatDocument[] {
  const flat: FlatDocument[] = [];
  function walk(nodes: SerializedDocumentTree[]) {
    for (const node of nodes) {
      flat.push({
        id: node.id,
        title: node.title,
        folder_id: node.folder_id,
        status_line: node.status_line,
        links: node.links,
        project_id: node.project_id,
        updated_at: node.updated_at,
      });
      walk(node.children);
    }
  }
  walk(trees);
  return flat;
}

/** Task ids that appear in any document's outgoing links. */
export function taskIdsWithLinkedDocuments(trees: SerializedDocumentTree[]): Set<string> {
  const ids = new Set<string>();
  for (const doc of flattenDocumentTree(trees)) {
    for (const link of doc.links) {
      if (link.type === 'task') {
        ids.add(link.id);
      }
    }
  }
  return ids;
}

/** Map task id → documents that link to it (outgoing doc→task edges). */
export function documentsByLinkedTask(
  trees: SerializedDocumentTree[],
): Map<string, FlatDocument[]> {
  const map = new Map<string, FlatDocument[]>();
  for (const doc of flattenDocumentTree(trees)) {
    for (const link of doc.links) {
      if (link.type !== 'task') {
        continue;
      }
      const list = map.get(link.id);
      if (list === undefined) {
        map.set(link.id, [doc]);
      } else if (!list.some((existing) => existing.id === doc.id)) {
        list.push(doc);
      }
    }
  }
  return map;
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

// Single-text-field dialog — replaces the banned native prompt() for new folder /
// new document / rename. Kept local: these are the only three text prompts here.
function TextDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'Create',
  busy = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setValue(initialValue);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed !== '') {
              onSubmit(trimmed);
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="text-dialog-input" className="text-xs text-muted-foreground">
              {label}
            </Label>
            <Input
              id="text-dialog-input"
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || trimmed === ''}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ROOT_VALUE = '__root__';

// Move-target picker (folder → different parent, or document → different folder).
// Native <select> stays keyboard-accessible; the searchable picker lands in a later slice.
function MoveDialog({
  open,
  onOpenChange,
  title,
  targets,
  currentId,
  busy = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  targets: SerializedFolder[];
  currentId: string | null;
  busy?: boolean;
  onSubmit: (folderId: string | null) => void;
}) {
  const [choice, setChoice] = useState<string>(currentId ?? ROOT_VALUE);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setChoice(currentId ?? ROOT_VALUE);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="move-destination" className="text-xs text-muted-foreground">
            Destination
          </Label>
          <select
            id="move-destination"
            value={choice}
            onChange={(event) => {
              setChoice(event.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value={ROOT_VALUE}>Unfiled (no folder)</option>
            {targets.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              onSubmit(choice === ROOT_VALUE ? null : choice);
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowKebab({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function statusText(statusLine: string | null): string | null {
  if (statusLine === null) {
    return null;
  }
  const trimmed = statusLine.replace(/^status:\s*/i, '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Stable expand-state key for the synthetic Unfiled root. */
export const UNFILED_FOLDER_KEY = '__unfiled__';

/** Drag payload for moving a document onto a folder / Unfiled. */
export const DOCUMENT_DRAG_MIME = 'application/x-plandesk-document-id';

export function folderExpandStorageKey(projectId: string): string {
  return `plandesk.docs.expandedFolders.${projectId}`;
}

/** Direct documents only — matches API `doc_count` (not recursive into sub-folders). */
export function directDocumentCount(documents: FlatDocument[], folderId: string | null): number {
  return documents.filter((doc) => doc.folder_id === folderId).length;
}

export function loadExpandedFolderIds(projectId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(folderExpandStorageKey(projectId));
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      return null;
    }
    return new Set(parsed);
  } catch {
    return null;
  }
}

export function saveExpandedFolderIds(projectId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(folderExpandStorageKey(projectId), JSON.stringify([...ids]));
  } catch {
    // Private mode / quota — expand state is best-effort.
  }
}

function defaultExpandedIds(folders: SerializedFolder[]): Set<string> {
  return new Set([UNFILED_FOLDER_KEY, ...folders.map((folder) => folder.id)]);
}

export function DocumentsPanel({
  projectId,
  documents,
  folders,
  tasks = [],
}: DocumentsPanelProps) {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<SerializedFolder | null>(null);
  const [folderToMove, setFolderToMove] = useState<SerializedFolder | null>(null);
  const [docToMove, setDocToMove] = useState<FlatDocument | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<SerializedFolder | null>(null);
  const [docToDelete, setDocToDelete] = useState<FlatDocument | null>(null);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocTask, setNewDocTask] = useState<string>(ROOT_VALUE);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const stored = loadExpandedFolderIds(projectId);
    return stored ?? defaultExpandedIds(folders);
  });
  /** Optimistic folder_id overrides while a move is in flight (doc id → folder id | null). */
  const [optimisticFolderById, setOptimisticFolderById] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const createFolder = useCreateFolder(projectId);
  const createDocument = useCreateDocument(projectId);
  const createEdge = useCreateEdge(projectId);
  const patchFolder = usePatchFolder();
  const patchDocument = usePatchDocument();
  const deleteFolder = useDeleteFolder();
  const deleteDocument = useDeleteDocument();

  const allDocuments = useMemo(() => flattenDocumentTree(documents), [documents]);
  const displayDocuments = useMemo(
    () =>
      allDocuments.map((doc) => {
        if (!optimisticFolderById.has(doc.id)) {
          return doc;
        }
        return { ...doc, folder_id: optimisticFolderById.get(doc.id) ?? null };
      }),
    [allDocuments, optimisticFolderById],
  );
  const taskLabelById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.label])),
    [tasks],
  );

  // Drop optimistic overrides once the server-backed props catch up.
  useEffect(() => {
    setOptimisticFolderById((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let changed = false;
      const next = new Map(prev);
      for (const [id, folderId] of prev) {
        const live = allDocuments.find((doc) => doc.id === id);
        if (live !== undefined && live.folder_id === folderId) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allDocuments]);

  // When folders arrive after first paint (or the set grows), expand new ids once.
  useEffect(() => {
    setExpandedIds((prev) => {
      const stored = loadExpandedFolderIds(projectId);
      if (stored !== null) {
        return stored;
      }
      const next = new Set(prev);
      let changed = false;
      for (const folder of folders) {
        if (!next.has(folder.id)) {
          next.add(folder.id);
          changed = true;
        }
      }
      if (!next.has(UNFILED_FOLDER_KEY)) {
        next.add(UNFILED_FOLDER_KEY);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [folders, projectId]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveExpandedFolderIds(projectId, next);
      return next;
    });
  };

  const recent = useMemo(
    () =>
      [...displayDocuments]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 4),
    [displayDocuments],
  );

  const rootFolders = childFoldersOf(folders, null);
  const unfiledDocuments = displayDocuments
    .filter((doc) => doc.folder_id === null)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const workspaceEmpty = folders.length === 0 && displayDocuments.length === 0;

  const handleCreateFolder = (name: string) => {
    createFolder.mutate(
      { name, parent_folder_id: null },
      {
        onSuccess: () => {
          toast('Folder created');
          setNewFolderOpen(false);
        },
      },
    );
  };

  const handleCreateDocument = () => {
    const title = newDocTitle.trim();
    if (title === '') {
      return;
    }
    const taskId = newDocTask === ROOT_VALUE ? null : newDocTask;
    createDocument.mutate(
      {
        title,
        folder_id: null,
      },
      {
        onSuccess: (created) => {
          const finish = () => {
            toast('Document created');
            setNewDocOpen(false);
            setNewDocTitle('');
            setNewDocTask(ROOT_VALUE);
          };
          if (taskId === null) {
            finish();
            return;
          }
          createEdge.mutate(
            {
              from_type: 'document',
              from_id: created.id,
              to_type: 'task',
              to_id: taskId,
              label: 'documents',
            },
            {
              onSuccess: finish,
              onError: () => {
                // Document exists; surface the link failure without rolling back.
                toast('Document created, but linking the task failed');
                setNewDocOpen(false);
                setNewDocTitle('');
                setNewDocTask(ROOT_VALUE);
              },
            },
          );
        },
      },
    );
  };

  const handleRenameFolder = (name: string) => {
    if (folderToRename === null) {
      return;
    }
    patchFolder.mutate(
      { id: folderToRename.id, input: { name } },
      {
        onSuccess: () => {
          toast('Folder renamed');
          setFolderToRename(null);
        },
      },
    );
  };

  const handleMoveFolder = (destination: string | null) => {
    if (folderToMove === null || destination === folderToMove.parent_folder_id) {
      setFolderToMove(null);
      return;
    }
    patchFolder.mutate(
      { id: folderToMove.id, input: { parent_folder_id: destination } },
      {
        onSuccess: () => {
          toast('Folder moved');
          setFolderToMove(null);
        },
      },
    );
  };

  const clearOptimisticFolder = (docId: string) => {
    setOptimisticFolderById((prev) => {
      if (!prev.has(docId)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(docId);
      return next;
    });
  };

  const moveDocumentToFolder = (docId: string, destination: string | null) => {
    const source = allDocuments.find((doc) => doc.id === docId);
    if (source === undefined) {
      return;
    }
    const current = optimisticFolderById.get(docId) ?? source.folder_id;
    if (current === destination) {
      return;
    }
    setOptimisticFolderById((prev) => {
      const next = new Map(prev);
      next.set(docId, destination);
      return next;
    });
    patchDocument.mutate(
      { id: docId, input: { folder_id: destination } },
      {
        onSuccess: () => {
          // Keep the optimistic folder_id until props catch up (see effect above).
          toast('Document moved');
          setDocToMove(null);
        },
        onError: () => {
          clearOptimisticFolder(docId);
          toast.error("Couldn't move document — it was restored.");
          setDocToMove(null);
        },
      },
    );
  };

  const handleMoveDocument = (destination: string | null) => {
    if (docToMove === null) {
      return;
    }
    const current = optimisticFolderById.get(docToMove.id) ?? docToMove.folder_id;
    if (destination === current) {
      setDocToMove(null);
      return;
    }
    moveDocumentToFolder(docToMove.id, destination);
  };

  const acceptDocumentDrop = (event: DragEvent, destination: string | null) => {
    event.preventDefault();
    setDropTargetKey(null);
    const docId = event.dataTransfer.getData(DOCUMENT_DRAG_MIME);
    if (docId === '') {
      return;
    }
    moveDocumentToFolder(docId, destination);
  };

  const folderDropHandlers = (destination: string | null, targetKey: string) => ({
    onDragOver: (event: DragEvent) => {
      if (![...event.dataTransfer.types].includes(DOCUMENT_DRAG_MIME)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetKey(targetKey);
    },
    onDragLeave: (event: DragEvent) => {
      // Ignore leave events that stay within the same target.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      setDropTargetKey((current) => (current === targetKey ? null : current));
    },
    onDrop: (event: DragEvent) => {
      acceptDocumentDrop(event, destination);
    },
  });

  const confirmDeleteFolder = () => {
    if (folderToDelete === null) {
      return;
    }
    deleteFolder.mutate(
      { id: folderToDelete.id, projectId },
      {
        onSuccess: () => {
          toast('Folder deleted');
          setFolderToDelete(null);
        },
      },
    );
  };

  const confirmDeleteDocument = () => {
    if (docToDelete === null) {
      return;
    }
    deleteDocument.mutate(
      { id: docToDelete.id, projectId },
      {
        onSuccess: () => {
          toast('Document deleted');
          setDocToDelete(null);
        },
      },
    );
  };

  const moveFolderTargets = folderToMove
    ? folders.filter(
        (candidate) =>
          candidate.id !== folderToMove.id &&
          !isDescendantFolder(folders, candidate.id, folderToMove.id),
      )
    : [];

  const renderDocumentRow = (doc: FlatDocument, depth: number) => (
    <li
      key={doc.id}
      draggable
      data-testid={`document-row-${doc.id}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(DOCUMENT_DRAG_MIME, doc.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        setDropTargetKey(null);
      }}
      className="group flex cursor-grab items-center gap-2 py-1.5 pr-2 transition-colors hover:bg-accent active:cursor-grabbing"
      style={{ paddingLeft: `${String(12 + depth * 16)}px` }}
    >
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <Link
        to="/projects/$id/documents/$docId"
        params={{ id: projectId, docId: doc.id }}
        className="min-w-0 flex-1 truncate text-[13.5px] hover:text-foreground"
      >
        {doc.title}
      </Link>
      {statusText(doc.status_line) !== null ? (
        <span className="max-w-[120px] shrink-0 truncate text-[11.5px] text-muted-foreground">
          {statusText(doc.status_line)}
        </span>
      ) : null}
      {doc.links
        .filter((link) => link.type === 'task')
        .slice(0, 2)
        .map((link) => (
          <Link
            key={link.edge_id}
            to="/projects/$id/board"
            params={{ id: projectId }}
            title={link.title}
            className="hidden max-w-[140px] shrink-0 truncate rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground md:inline-block"
          >
            {taskLabelById.get(link.id) ?? link.title}
          </Link>
        ))}
      {doc.links.filter((link) => link.type === 'task').length > 2 ? (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground md:inline">
          +{doc.links.filter((link) => link.type === 'task').length - 2}
        </span>
      ) : null}
      <RowKebab label={`Actions for document ${doc.title}`}>
        <DropdownMenuItem
          onSelect={() => {
            setDocToMove(doc);
          }}
        >
          Move…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            setDocToDelete(doc);
          }}
        >
          Delete
        </DropdownMenuItem>
      </RowKebab>
    </li>
  );

  const renderFolderNode = (folder: SerializedFolder, depth: number): ReactNode => {
    const childFolders = childFoldersOf(folders, folder.id);
    const folderDocs = displayDocuments
      .filter((doc) => doc.folder_id === folder.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const docCount = directDocumentCount(displayDocuments, folder.id);
    const isOpen = expandedIds.has(folder.id);
    const isEmpty = childFolders.length === 0 && folderDocs.length === 0;
    const isDropTarget = dropTargetKey === folder.id;
    const dropHandlers = folderDropHandlers(folder.id, folder.id);

    return (
      <li key={folder.id} className="list-none">
        <div
          data-testid={`folder-drop-${folder.id}`}
          className={
            isDropTarget
              ? 'group flex items-center gap-1 bg-accent py-1.5 pr-2 ring-1 ring-inset ring-ring transition-colors'
              : 'group flex items-center gap-1 py-1.5 pr-2 transition-colors hover:bg-accent'
          }
          style={{ paddingLeft: `${String(4 + depth * 16)}px` }}
          {...dropHandlers}
        >
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse folder ${folder.name}` : `Expand folder ${folder.name}`}
            onClick={() => {
              toggleExpanded(folder.id);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
          </button>
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{folder.name}</span>
          <span className="shrink-0 text-[11.5px] text-muted-foreground" data-testid={`doc-count-${folder.id}`}>
            {docCount}
          </span>
          <RowKebab label={`Actions for folder ${folder.name}`}>
            <DropdownMenuItem
              onSelect={() => {
                setFolderToRename(folder);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setFolderToMove(folder);
              }}
            >
              Move…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                setFolderToDelete(folder);
              }}
            >
              Delete
            </DropdownMenuItem>
          </RowKebab>
        </div>
        {isOpen ? (
          <ul>
            {childFolders.map((child) => renderFolderNode(child, depth + 1))}
            {folderDocs.map((doc) => renderDocumentRow(doc, depth + 1))}
            {isEmpty ? (
              <li
                className="py-1.5 text-[12.5px] text-muted-foreground"
                style={{ paddingLeft: `${String(28 + depth * 16)}px` }}
              >
                This folder is empty.
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  const unfiledOpen = expandedIds.has(UNFILED_FOLDER_KEY);
  const unfiledCount = directDocumentCount(displayDocuments, null);
  const unfiledDropHandlers = folderDropHandlers(null, UNFILED_FOLDER_KEY);
  const unfiledIsDropTarget = dropTargetKey === UNFILED_FOLDER_KEY;

  return (
    <section aria-label="Documents">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-foreground">Documents</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={createFolder.isPending}
            onClick={() => {
              setNewFolderOpen(true);
            }}
          >
            <FolderPlusIcon className="size-3.5" /> New folder
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={createDocument.isPending}
            onClick={() => {
              setNewDocOpen(true);
            }}
          >
            <FilePlusIcon className="size-3.5" /> New document
          </Button>
        </div>
      </div>

      {recent.length > 0 ? (
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ClockIcon className="size-3.5" /> Recent
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((doc) => (
              <Link
                key={doc.id}
                to="/projects/$id/documents/$docId"
                params={{ id: projectId, docId: doc.id }}
                className="group flex flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:border-[var(--border-strong)] hover:bg-accent"
              >
                <FileTextIcon className="size-4 text-muted-foreground" />
                <span className="line-clamp-2 text-[13px] font-medium leading-snug">
                  {doc.title}
                </span>
                {statusText(doc.status_line) !== null ? (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {statusText(doc.status_line)}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {workspaceEmpty ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-[13px] text-muted-foreground">
          No documents yet. Create one to start a spec, design, or investigation.
        </p>
      ) : (
        <ul className="rounded-lg border py-1" aria-label="Folder tree">
          {rootFolders.map((folder) => renderFolderNode(folder, 0))}
          <li className="list-none">
            <div
              data-testid="folder-drop-unfiled"
              className={
                unfiledIsDropTarget
                  ? 'group flex items-center gap-1 bg-accent py-1.5 pr-2 ring-1 ring-inset ring-ring transition-colors'
                  : 'group flex items-center gap-1 py-1.5 pr-2 transition-colors hover:bg-accent'
              }
              style={{ paddingLeft: '4px' }}
              {...unfiledDropHandlers}
            >
              <button
                type="button"
                aria-expanded={unfiledOpen}
                aria-label={unfiledOpen ? 'Collapse Unfiled' : 'Expand Unfiled'}
                onClick={() => {
                  toggleExpanded(UNFILED_FOLDER_KEY);
                }}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                {unfiledOpen ? (
                  <ChevronDownIcon className="size-3.5" />
                ) : (
                  <ChevronRightIcon className="size-3.5" />
                )}
              </button>
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">Unfiled</span>
              <span className="shrink-0 text-[11.5px] text-muted-foreground" data-testid="doc-count-unfiled">
                {unfiledCount}
              </span>
            </div>
            {unfiledOpen ? (
              <ul>
                {unfiledDocuments.map((doc) => renderDocumentRow(doc, 1))}
                {unfiledDocuments.length === 0 ? (
                  <li className="py-1.5 text-[12.5px] text-muted-foreground" style={{ paddingLeft: '28px' }}>
                    No unfiled documents.
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        </ul>
      )}

      <TextDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="New folder"
        label="Folder name"
        placeholder="e.g. Design specs"
        confirmLabel="Create folder"
        busy={createFolder.isPending}
        onSubmit={handleCreateFolder}
      />

      <Dialog
        open={newDocOpen}
        onOpenChange={(next) => {
          setNewDocOpen(next);
          if (!next) {
            setNewDocTitle('');
            setNewDocTask(ROOT_VALUE);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleCreateDocument();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-doc-title" className="text-xs text-muted-foreground">
                Title
              </Label>
              <Input
                id="new-doc-title"
                autoFocus
                value={newDocTitle}
                placeholder="e.g. Design: caching layer"
                onChange={(event) => {
                  setNewDocTitle(event.target.value);
                }}
              />
            </div>
            {tasks.length > 0 ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Link to a task (optional)</Label>
                <Select value={newDocTask} onValueChange={setNewDocTask}>
                  <SelectTrigger>
                    <SelectValue placeholder="No linked task" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT_VALUE}>No linked task</SelectItem>
                    {tasks.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewDocOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createDocument.isPending ||
                  createEdge.isPending ||
                  newDocTitle.trim() === ''
                }
              >
                Create document
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TextDialog
        open={folderToRename !== null}
        onOpenChange={(next) => {
          if (!next) {
            setFolderToRename(null);
          }
        }}
        title="Rename folder"
        label="Folder name"
        initialValue={folderToRename?.name ?? ''}
        confirmLabel="Rename"
        busy={patchFolder.isPending}
        onSubmit={handleRenameFolder}
      />

      <MoveDialog
        open={folderToMove !== null}
        onOpenChange={(next) => {
          if (!next) {
            setFolderToMove(null);
          }
        }}
        title={folderToMove === null ? '' : `Move "${folderToMove.name}"`}
        targets={moveFolderTargets}
        currentId={folderToMove?.parent_folder_id ?? null}
        busy={patchFolder.isPending}
        onSubmit={handleMoveFolder}
      />

      <MoveDialog
        open={docToMove !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDocToMove(null);
          }
        }}
        title={docToMove === null ? '' : `Move "${docToMove.title}"`}
        targets={folders}
        currentId={docToMove?.folder_id ?? null}
        busy={patchDocument.isPending}
        onSubmit={handleMoveDocument}
      />

      <ConfirmDialog
        open={folderToDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setFolderToDelete(null);
          }
        }}
        title={folderToDelete === null ? '' : `Delete folder "${folderToDelete.name}"?`}
        description="Its documents and subfolders move up a level — nothing is orphaned."
        busy={deleteFolder.isPending}
        onConfirm={confirmDeleteFolder}
      />
      <ConfirmDialog
        open={docToDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDocToDelete(null);
          }
        }}
        title={docToDelete === null ? '' : `Delete "${docToDelete.title}"?`}
        description="This document and its comments will be deleted. This cannot be undone."
        busy={deleteDocument.isPending}
        onConfirm={confirmDeleteDocument}
      />
    </section>
  );
}
