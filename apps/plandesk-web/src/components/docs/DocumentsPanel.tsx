import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
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
  SerializedFolder,
  SerializedTask,
} from '../../lib/api.js';
import {
  useCreateDocument,
  useCreateFolder,
  useDeleteDocument,
  useDeleteFolder,
  usePatchDocument,
  usePatchFolder,
} from '../../lib/queries.js';
import { cn } from '@/lib/utils';
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
  linked_task_id: string | null;
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
        linked_task_id: node.linked_task_id,
        updated_at: node.updated_at,
      });
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
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a destination" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROOT_VALUE}>Root (no folder)</SelectItem>
            {targets.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

function RowKebab({ label, children }: { label: string; children: React.ReactNode }) {
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

export function DocumentsPanel({
  projectId,
  documents,
  folders,
  tasks = [],
}: DocumentsPanelProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<SerializedFolder | null>(null);
  const [folderToMove, setFolderToMove] = useState<SerializedFolder | null>(null);
  const [docToMove, setDocToMove] = useState<FlatDocument | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<SerializedFolder | null>(null);
  const [docToDelete, setDocToDelete] = useState<FlatDocument | null>(null);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocTask, setNewDocTask] = useState<string>(ROOT_VALUE);

  const createFolder = useCreateFolder(projectId);
  const createDocument = useCreateDocument(projectId);
  const patchFolder = usePatchFolder();
  const patchDocument = usePatchDocument();
  const deleteFolder = useDeleteFolder();
  const deleteDocument = useDeleteDocument();

  const allDocuments = useMemo(() => flattenDocumentTree(documents), [documents]);
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const taskLabelById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t.label])),
    [tasks],
  );

  // Breadcrumb trail from root to the current folder.
  const trail = useMemo(() => {
    const chain: SerializedFolder[] = [];
    let cursor = currentFolderId;
    while (cursor !== null) {
      const folder = folderById.get(cursor);
      if (folder === undefined) {
        break;
      }
      chain.unshift(folder);
      cursor = folder.parent_folder_id;
    }
    return chain;
  }, [currentFolderId, folderById]);

  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const childFolders = childFoldersOf(folders, currentFolderId);
  const visibleDocuments = allDocuments
    .filter((doc) =>
      currentFolderId === null
        ? doc.folder_id === null || !folderIds.has(doc.folder_id)
        : doc.folder_id === currentFolderId,
    )
    // Most-recently-updated first, matching the Recent strip above.
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const recent = useMemo(
    () =>
      [...allDocuments]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 4),
    [allDocuments],
  );

  const directDocCount = (folderId: string) =>
    allDocuments.filter((doc) => doc.folder_id === folderId).length;

  const handleCreateFolder = (name: string) => {
    createFolder.mutate(
      { name, parent_folder_id: currentFolderId },
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
    createDocument.mutate(
      {
        title,
        folder_id: currentFolderId,
        linked_task_id: newDocTask === ROOT_VALUE ? null : newDocTask,
      },
      {
        onSuccess: () => {
          toast('Document created');
          setNewDocOpen(false);
          setNewDocTitle('');
          setNewDocTask(ROOT_VALUE);
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

  const handleMoveDocument = (destination: string | null) => {
    if (docToMove === null || destination === docToMove.folder_id) {
      setDocToMove(null);
      return;
    }
    patchDocument.mutate(
      { id: docToMove.id, input: { folder_id: destination } },
      {
        onSuccess: () => {
          toast('Document moved');
          setDocToMove(null);
        },
      },
    );
  };

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

  const isEmpty = childFolders.length === 0 && visibleDocuments.length === 0;

  return (
    <section aria-label="Documents">
      {/* Toolbar: breadcrumb + create actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path" className="flex items-center gap-1 text-[13px]">
          <button
            type="button"
            onClick={() => {
              setCurrentFolderId(null);
            }}
            className={cn(
              'rounded px-1.5 py-0.5 transition-colors hover:text-foreground',
              currentFolderId === null ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            Documents
          </button>
          {trail.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRightIcon className="size-3.5 text-muted-foreground/60" />
              <button
                type="button"
                onClick={() => {
                  setCurrentFolderId(folder.id);
                }}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors hover:text-foreground',
                  index === trail.length - 1
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
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

      {/* Recent — only at the root, surfaces what agents/teammates changed last */}
      {currentFolderId === null && recent.length > 0 ? (
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

      {/* Folders as cards */}
      {childFolders.length > 0 ? (
        <div className="mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Folders
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {childFolders.map((folder) => {
              const docCount = directDocCount(folder.id);
              const subCount = childFoldersOf(folders, folder.id).length;
              return (
                <div
                  key={folder.id}
                  className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-[var(--border-strong)] hover:bg-accent"
                >
                  <button
                    type="button"
                    aria-label={`Open folder ${folder.name}`}
                    onClick={() => {
                      setCurrentFolderId(folder.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <FolderIcon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">
                        {folder.name}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {docCount} {docCount === 1 ? 'document' : 'documents'}
                        {subCount > 0 ? ` · ${String(subCount)} ${subCount === 1 ? 'folder' : 'folders'}` : ''}
                      </span>
                    </span>
                  </button>
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
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Documents at the current level as a calm list */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {currentFolderId === null ? 'All documents' : 'Documents'}
        </div>
        {isEmpty ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-[13px] text-muted-foreground">
            {currentFolderId === null
              ? 'No documents yet. Create one to start a spec, design, or investigation.'
              : 'This folder is empty.'}
          </p>
        ) : visibleDocuments.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">No documents at this level.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {visibleDocuments.map((doc) => (
              <li
                key={doc.id}
                className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent"
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
                {doc.linked_task_id !== null && taskLabelById.has(doc.linked_task_id) ? (
                  <Link
                    to="/projects/$id/board"
                    params={{ id: projectId }}
                    className="hidden shrink-0 items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground md:inline-flex"
                  >
                    {taskLabelById.get(doc.linked_task_id)}
                  </Link>
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
            ))}
          </ul>
        )}
      </div>

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
              <Button type="submit" disabled={createDocument.isPending || newDocTitle.trim() === ''}>
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
