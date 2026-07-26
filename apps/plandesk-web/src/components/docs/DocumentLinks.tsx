import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FileTextIcon, LinkIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_DOCUMENT_EDGE_LABEL,
  documentEdgeLabels,
  type DocumentEdgeLabel,
  type LinkEntityType,
  type SerializedDocument,
  type SerializedEntityLink,
  type SerializedTask,
} from '../../lib/api.js';
import { useCreateEdge, useDeleteEdge, useDocuments, useTasks } from '../../lib/queries.js';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { flattenDocumentTree } from './DocumentsPanel.js';

const documentEdgeLabelFriendly: Record<DocumentEdgeLabel, string> = {
  documents: 'documents',
  references: 'references',
  supersedes: 'supersedes',
  extends: 'extends',
};

type DocumentLinksProps = {
  projectId: string;
  document: SerializedDocument;
  /** When false, hide the add/remove controls (reader mode). */
  editable?: boolean;
};

function groupLinks(entries: SerializedEntityLink[]): {
  tasks: SerializedEntityLink[];
  documents: SerializedEntityLink[];
} {
  const tasks: SerializedEntityLink[] = [];
  const documents: SerializedEntityLink[] = [];
  for (const entry of entries) {
    if (entry.type === 'task') {
      tasks.push(entry);
    } else {
      documents.push(entry);
    }
  }
  return { tasks, documents };
}

function LinkEntryRow({
  projectId,
  entry,
  onRemove,
  busy,
}: {
  projectId: string;
  entry: SerializedEntityLink;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const label = entry.label !== null && entry.label !== '' ? entry.label : null;
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
      {entry.type === 'task' ? (
        <Link
          to="/projects/$id/board"
          params={{ id: projectId }}
          className="min-w-0 flex-1 truncate text-[13px] font-medium hover:underline"
          title={`Open board (task: ${entry.title})`}
        >
          {entry.title}
        </Link>
      ) : (
        <Link
          to="/projects/$id/documents/$docId"
          params={{ id: projectId, docId: entry.id }}
          className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] font-medium hover:underline"
        >
          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.title}</span>
        </Link>
      )}
      <span className="shrink-0 rounded-full border bg-muted/50 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {entry.type}
      </span>
      {label !== null ? (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{label}</span>
      ) : null}
      {onRemove !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove link to ${entry.title}`}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          disabled={busy === true}
          onClick={onRemove}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
}

function LinkGroup({
  title,
  entries,
  projectId,
  onRemove,
  busy,
}: {
  title: string;
  entries: SerializedEntityLink[];
  projectId: string;
  onRemove?: (edgeId: string) => void;
  busy?: boolean;
}) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1">
      <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <LinkEntryRow
            key={entry.edge_id}
            projectId={projectId}
            entry={entry}
            busy={busy}
            onRemove={
              onRemove !== undefined
                ? () => {
                    onRemove(entry.edge_id);
                  }
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}

type LinkPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documentId: string;
  existingLinkKeys: Set<string>;
  tasks: SerializedTask[];
  documents: Array<{ id: string; title: string }>;
  onCreate: (input: {
    to_type: LinkEntityType;
    to_id: string;
    label: DocumentEdgeLabel;
  }) => void;
  busy: boolean;
};

function LinkPickerDialog({
  open,
  onOpenChange,
  documentId,
  existingLinkKeys,
  tasks,
  documents,
  onCreate,
  busy,
}: LinkPickerProps) {
  const [targetType, setTargetType] = useState<LinkEntityType>('task');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState<DocumentEdgeLabel>(DEFAULT_DOCUMENT_EDGE_LABEL);

  const reset = () => {
    setTargetType('task');
    setQuery('');
    setSelectedId(null);
    setLabel(DEFAULT_DOCUMENT_EDGE_LABEL);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (targetType === 'task') {
      return tasks
        .filter((task) => !existingLinkKeys.has(`task:${task.id}`))
        .filter((task) => (q === '' ? true : task.label.toLowerCase().includes(q)))
        .slice(0, 12)
        .map((task) => ({ id: task.id, title: task.label }));
    }
    return documents
      .filter((doc) => doc.id !== documentId && !existingLinkKeys.has(`document:${doc.id}`))
      .filter((doc) => (q === '' ? true : doc.title.toLowerCase().includes(q)))
      .slice(0, 12);
  }, [targetType, tasks, documents, documentId, existingLinkKeys, query]);

  const selected = filtered.find((item) => item.id === selectedId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          reset();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Target type</Label>
            <Select
              value={targetType}
              onValueChange={(value) => {
                setTargetType(value as LinkEntityType);
                setSelectedId(null);
                setQuery('');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="document">Document</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <Input
              id="link-search"
              value={query}
              placeholder={targetType === 'task' ? 'Filter tasks…' : 'Filter documents…'}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12.5px] text-muted-foreground">
                No matching {targetType === 'task' ? 'tasks' : 'documents'}.
              </p>
            ) : (
              filtered.map((item) => {
                const active = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                      active ? 'bg-accent font-medium' : 'hover:bg-accent/60'
                    }`}
                    onClick={() => {
                      setSelectedId(item.id);
                    }}
                  >
                    {targetType === 'document' ? (
                      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Label</Label>
            <Select
              value={label}
              onValueChange={(value) => {
                setLabel(value as DocumentEdgeLabel);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {documentEdgeLabels.map((option) => (
                  <SelectItem key={option} value={option}>
                    {documentEdgeLabelFriendly[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            disabled={selected === null || busy}
            onClick={() => {
              if (selected === null) {
                return;
              }
              onCreate({ to_type: targetType, to_id: selected.id, label });
            }}
          >
            {busy ? 'Linking…' : 'Add link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentLinks({ projectId, document, editable = true }: DocumentLinksProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const createEdge = useCreateEdge(projectId);
  const deleteEdge = useDeleteEdge(projectId);
  const { data: tasks } = useTasks(projectId);
  const { data: allDocuments } = useDocuments(projectId);

  const docOptions = useMemo(
    () =>
      flattenDocumentTree(allDocuments ?? []).map((doc) => ({
        id: doc.id,
        title: doc.title,
      })),
    [allDocuments],
  );

  const existingLinkKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const link of document.links) {
      keys.add(`${link.type}:${link.id}`);
    }
    return keys;
  }, [document.links]);

  const outgoing = groupLinks(document.links);
  const incoming = groupLinks(document.backlinks);
  const hasOutgoing = outgoing.tasks.length + outgoing.documents.length > 0;
  const hasIncoming = incoming.tasks.length + incoming.documents.length > 0;

  const handleCreate = (input: {
    to_type: LinkEntityType;
    to_id: string;
    label: DocumentEdgeLabel;
  }) => {
    createEdge.mutate(
      {
        from_type: 'document',
        from_id: document.id,
        to_type: input.to_type,
        to_id: input.to_id,
        label: input.label,
      },
      {
        onSuccess: () => {
          toast('Link added');
          setPickerOpen(false);
        },
        onError: (error) => {
          toast(error instanceof Error ? error.message : 'Failed to add link');
        },
      },
    );
  };

  const handleRemove = (edgeId: string) => {
    deleteEdge.mutate(edgeId, {
      onSuccess: () => {
        toast('Link removed');
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : 'Failed to remove link');
      },
    });
  };

  return (
    <section aria-label="Document links" className="space-y-4 border-t pt-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Links
          </h2>
          {editable ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto"
              aria-label="Add link"
              onClick={() => {
                setPickerOpen(true);
              }}
            >
              <PlusIcon className="size-3.5" />
              Add link
            </Button>
          ) : null}
        </div>
        {!hasOutgoing ? (
          <p className="px-2 text-[12.5px] text-muted-foreground">
            No outgoing links. Link tasks this document covers, or related specs.
          </p>
        ) : (
          <div className="space-y-3">
            <LinkGroup
              title="Tasks"
              entries={outgoing.tasks}
              projectId={projectId}
              busy={deleteEdge.isPending}
              onRemove={editable ? handleRemove : undefined}
            />
            <LinkGroup
              title="Documents"
              entries={outgoing.documents}
              projectId={projectId}
              busy={deleteEdge.isPending}
              onRemove={editable ? handleRemove : undefined}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Backlinks
        </h2>
        {!hasIncoming ? (
          <p className="px-2 text-[12.5px] text-muted-foreground">Nothing points here yet.</p>
        ) : (
          <div className="space-y-3">
            <LinkGroup title="Tasks" entries={incoming.tasks} projectId={projectId} />
            <LinkGroup title="Documents" entries={incoming.documents} projectId={projectId} />
          </div>
        )}
      </div>

      {editable ? (
        <LinkPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          projectId={projectId}
          documentId={document.id}
          existingLinkKeys={existingLinkKeys}
          tasks={tasks ?? []}
          documents={docOptions}
          onCreate={handleCreate}
          busy={createEdge.isPending}
        />
      ) : null}
    </section>
  );
}

