import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FileTextIcon, PencilIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusMenu } from '../board/StatusChip.js';
import { CommentsPanel } from '../docs/CommentsPanel.js';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';
import { documentsByLinkedTask, flattenDocumentTree } from '../docs/DocumentsPanel.js';
import { useDocuments } from '../../lib/queries.js';
import type { SerializedTag, TaskStatus } from '../../lib/api.js';
import type { TaskNodeData } from './canvas-map.js';

type TaskDetailProps = {
  taskId: string;
  data: TaskNodeData;
  onPatch: (input: {
    label?: string;
    status?: TaskStatus;
    description?: string | null;
    assignee?: string | null;
    due_date?: string | null;
  }) => void;
  onDelete: () => void;
  onClose?: () => void;
  isSaving?: boolean;
  tags?: SerializedTag[];
  tagSuggestions?: string[];
  onAddTag?: (name: string) => void;
  onRemoveTag?: (name: string) => void;
};

export function TaskDetail({
  taskId,
  data,
  onPatch,
  onDelete,
  onClose,
  isSaving = false,
  tags,
  tagSuggestions = [],
  onAddTag,
  onRemoveTag,
}: TaskDetailProps) {
  const [label, setLabel] = useState(data.label);
  const [assignee, setAssignee] = useState(data.assignee ?? '');
  const [dueDate, setDueDate] = useState(data.dueDate !== null ? data.dueDate.slice(0, 10) : '');
  const [newTag, setNewTag] = useState('');
  const [editing, setEditing] = useState(false);
  const [pendingPassage, setPendingPassage] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const { data: allDocuments } = useDocuments(data.projectId);
  const docLinks = flattenDocumentTree(allDocuments ?? []).map((doc) => ({
    id: doc.id,
    title: doc.title,
  }));
  const linkedDocs = documentsByLinkedTask(allDocuments ?? []).get(taskId) ?? [];

  useEffect(() => {
    setLabel(data.label);
    setAssignee(data.assignee ?? '');
    setDueDate(data.dueDate !== null ? data.dueDate.slice(0, 10) : '');
    setNewTag('');
    setPendingPassage(null);
    setEditing(false);
  }, [taskId, data.label, data.assignee, data.dueDate]);

  const handleSave = () => {
    const trimmedLabel = label.trim();
    const handle = editorRef.current;
    // Only re-serialize the description when the user actually edited it. Task
    // descriptions are Markdown the MCP reads/writes; the rich round-trip is
    // intentionally lossy vs. raw Markdown, so an untouched description is left
    // exactly as the agent authored it. When edited, serialize back to Markdown.
    let descriptionPatch: { description?: string | null } = {};
    if (handle !== null && handle.isDirty()) {
      const markdown = handle.getMarkdown().trim();
      descriptionPatch = { description: markdown === '' ? null : markdown };
    }
    onPatch({
      ...(trimmedLabel !== '' && trimmedLabel !== data.label ? { label: trimmedLabel } : {}),
      ...descriptionPatch,
      assignee: assignee.trim() === '' ? null : assignee.trim(),
      due_date: dueDate === '' ? null : `${dueDate}T00:00:00.000Z`,
    });
    setEditing(false);
  };

  const handleDelete = () => {
    if (confirm('Delete this task? Connected edges will be removed.')) {
      onDelete();
    }
  };

  const hasTagEditor = onAddTag !== undefined && onRemoveTag !== undefined;
  const tagList = tags ?? [];

  return (
    <aside
      aria-label="Task details"
      // Bottom-anchored below the desktop breakpoint, where a floating 340px
      // card would cover most of the canvas and collide with the top-right
      // panel. Deliberately not a modal Sheet: inspecting a node while looking
      // at the graph is the point, and a modal would block the canvas.
      className="absolute inset-x-2 bottom-2 z-30 flex max-h-[55%] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-pop)] lg:inset-x-auto lg:right-2 lg:top-2 lg:bottom-auto lg:max-h-[calc(100%-1rem)] lg:w-[340px]"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <StatusMenu
          status={data.status}
          onChange={(status) => {
            onPatch({ status });
          }}
        />
        <span className="ml-auto" />
        <Button
          type="button"
          variant={editing ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={editing ? 'Stop editing' : 'Edit task'}
          onClick={() => {
            setEditing((value) => !value);
          }}
        >
          {editing ? (
            'Done'
          ) : (
            <>
              <PencilIcon className="size-3.5" /> Edit
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete task"
          title="Delete task"
          className="text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
        >
          <XIcon />
        </Button>
        {onClose !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close task details"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {editing ? (
          <>
            <Label htmlFor={`task-label-${taskId}`} className="mb-1 text-muted-foreground">
              Label
            </Label>
            <Input
              id={`task-label-${taskId}`}
              type="text"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              className="mb-3 font-semibold"
            />
          </>
        ) : (
          <h3 className="mb-3 text-[15px] font-semibold leading-snug">{data.label}</h3>
        )}

        <dl className="grid grid-cols-1 gap-y-2 py-1 text-[12.5px] sm:grid-cols-[80px_1fr]">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <StatusMenu
              status={data.status}
              onChange={(status) => {
                onPatch({ status });
              }}
            />
          </dd>
          <dt className="text-muted-foreground">Assignee</dt>
          <dd>
            {editing ? null : (
              <span className="text-[var(--text-2)]">{data.assignee ?? 'Unassigned'}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd>
            {editing ? null : (
              <span className="text-[var(--text-2)]">
                {data.dueDate !== null ? data.dueDate.slice(0, 10) : '—'}
              </span>
            )}
          </dd>
          {linkedDocs.length > 0 ? (
            <>
              <dt className="text-muted-foreground">{linkedDocs.length === 1 ? 'Doc' : 'Docs'}</dt>
              <dd className="flex flex-col gap-1">
                {linkedDocs.map((doc) => (
                  <Link
                    key={doc.id}
                    to="/projects/$id/documents/$docId"
                    params={{ id: data.projectId, docId: doc.id }}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
                  >
                    <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.title}</span>
                  </Link>
                ))}
              </dd>
            </>
          ) : null}
        </dl>

        {editing ? (
          <>
            <Label
              htmlFor={`task-assignee-${taskId}`}
              className="mt-3 mb-1 block text-muted-foreground"
            >
              Assignee
            </Label>
            <Input
              id={`task-assignee-${taskId}`}
              type="text"
              value={assignee}
              onChange={(event) => {
                setAssignee(event.target.value);
              }}
              placeholder="Unassigned"
              className="mb-3"
            />
            <Label htmlFor={`task-due-${taskId}`} className="mb-1 block text-muted-foreground">
              Due date
            </Label>
            <Input
              id={`task-due-${taskId}`}
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
              }}
              className="mb-3"
            />
          </>
        ) : null}

        <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </div>
        <RichTextEditor
          ref={editorRef}
          value={data.description ?? ''}
          mode={editing ? 'editor' : 'reader'}
          minHeight="5rem"
          ariaLabel="Description"
          projectId={data.projectId}
          seamless={false}
          docLinks={docLinks}
          onCommentOnSelection={(passage) => {
            setPendingPassage(passage);
          }}
        />

        {hasTagEditor ? (
          <>
            <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Tags
            </div>
            {tagList.length > 0 ? (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {tagList.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium"
                  >
                    {tag.color !== null ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    ) : null}
                    {tag.name}
                    {editing ? (
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag.name}`}
                        onClick={() => {
                          onRemoveTag(tag.name);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            {editing ? (
              <form
                className="flex gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = newTag.trim();
                  if (trimmed === '') {
                    return;
                  }
                  onAddTag(trimmed);
                  setNewTag('');
                }}
              >
                <Input
                  id={`task-tag-input-${taskId}`}
                  type="text"
                  value={newTag}
                  onChange={(event) => {
                    setNewTag(event.target.value);
                  }}
                  placeholder="Add tag"
                  list={`task-tag-options-${taskId}`}
                  aria-label="Add tag"
                />
                <datalist id={`task-tag-options-${taskId}`}>
                  {tagSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <Button type="submit" variant="outline" size="sm" disabled={newTag.trim() === ''}>
                  Add tag
                </Button>
              </form>
            ) : null}
          </>
        ) : null}

        <CommentsPanel
          target={{ type: 'task', id: taskId }}
          attachPassage={pendingPassage}
          onPassageConsumed={() => {
            setPendingPassage(null);
          }}
          embedded
        />
      </div>

      {editing ? (
        <footer className="border-t border-border p-3">
          <Button type="button" className="w-full" disabled={isSaving} onClick={handleSave}>
            {isSaving ? 'Saving…' : 'Save details'}
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}
