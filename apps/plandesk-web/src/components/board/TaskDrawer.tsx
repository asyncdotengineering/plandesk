import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FileTextIcon, PencilIcon, XIcon } from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import type { RichTextEditorHandle } from '../editor/RichTextEditor.js';
import { RichTextEditor } from '../editor/RichTextEditor.js';
import { flattenDocumentTree } from '../docs/DocumentsPanel.js';
import { useDocuments } from '../../lib/queries.js';
import { CommentsPanel } from '../docs/CommentsPanel.js';
import type { PatchTaskInput, SerializedTag, SerializedTask, TaskStatus } from '../../lib/api.js';
import { laneFromTags, LANE_TAG_PREFIX } from './board-utils.js';
import { StatusMenu } from './StatusChip.js';

type LinkedDocRef = {
  id: string;
  title: string;
  project_id: string;
};

type TaskDrawerProps = {
  task: SerializedTask | null;
  linkedDocs?: LinkedDocRef[];
  tagSuggestions: string[];
  open: boolean;
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (input: PatchTaskInput) => void;
  onChangeStatus: (status: TaskStatus) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
};

export function TaskDrawer({
  task,
  linkedDocs = [],
  tagSuggestions,
  open,
  isSaving = false,
  onOpenChange,
  onPatch,
  onChangeStatus,
  onAddTag,
  onRemoveTag,
}: TaskDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-label="Task details"
        showCloseButton={false}
        className="w-[75vw] gap-0 p-0 sm:max-w-[75vw]"
      >
        <SheetTitle className="sr-only">Task details</SheetTitle>
        <SheetDescription className="sr-only">View and edit the task.</SheetDescription>
        {task !== null ? (
          <TaskDrawerBody
            task={task}
            linkedDocs={linkedDocs}
            tagSuggestions={tagSuggestions}
            isSaving={isSaving}
            onPatch={onPatch}
            onChangeStatus={onChangeStatus}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type TaskDrawerBodyProps = {
  task: SerializedTask;
  linkedDocs: LinkedDocRef[];
  tagSuggestions: string[];
  isSaving: boolean;
  onPatch: (input: PatchTaskInput) => void;
  onChangeStatus: (status: TaskStatus) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
  onClose: () => void;
};

function TaskDrawerBody({
  task,
  linkedDocs,
  tagSuggestions,
  isSaving,
  onPatch,
  onChangeStatus,
  onAddTag,
  onRemoveTag,
  onClose,
}: TaskDrawerBodyProps) {
  const [label, setLabel] = useState(task.label);
  const [newTag, setNewTag] = useState('');
  // Open in read mode; editing is an explicit choice via the Edit toggle.
  const [editing, setEditing] = useState(false);
  const [pendingPassage, setPendingPassage] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const { data: allDocuments } = useDocuments(task.project_id);
  const docLinks = flattenDocumentTree(allDocuments ?? []).map((doc) => ({
    id: doc.id,
    title: doc.title,
  }));

  useEffect(() => {
    setLabel(task.label);
    setNewTag('');
    setEditing(false);
  }, [task.id, task.label]);

  const lane = laneFromTags(task.tags);

  // Only re-serialize the description when the user actually edited it. Task
  // descriptions are Markdown the MCP reads/writes; the rich round-trip is
  // intentionally lossy vs. raw Markdown, so an untouched description stays
  // exactly as authored. When edited, serialize back to Markdown.
  const handleSave = () => {
    const trimmedLabel = label.trim();
    let descriptionPatch: { description?: string | null } = {};
    const handle = editorRef.current;
    if (handle !== null && handle.isDirty()) {
      const markdown = handle.getMarkdown().trim();
      descriptionPatch = { description: markdown === '' ? null : markdown };
    }
    onPatch({
      ...(trimmedLabel !== '' && trimmedLabel !== task.label ? { label: trimmedLabel } : {}),
      ...descriptionPatch,
    });
    setEditing(false);
  };

  const tags = task.tags ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <StatusMenu status={task.status} onChange={onChangeStatus} />
        <span
          className="mono text-xs text-muted-foreground"
          title="Short ID — last 4 characters of this task's ID, for quick reference"
        >
          {shortId(task.id)}
        </span>
        <span className="ml-auto" />
        <ShareButton resource={{ kind: 'task', id: task.id }} />
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
          aria-label="Close task details"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {editing ? (
          <>
            <Label htmlFor="task-drawer-label" className="mb-1 text-muted-foreground">
              Label
            </Label>
            <Input
              id="task-drawer-label"
              aria-label="Label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              className="mb-3 font-semibold"
            />
          </>
        ) : (
          <h2 className="mb-3 text-[15px] font-semibold leading-snug">{task.label}</h2>
        )}

        <dl className="grid grid-cols-[92px_1fr] gap-y-2 py-1 text-[12.5px]">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <StatusMenu status={task.status} onChange={onChangeStatus} />
          </dd>
          <dt className="text-muted-foreground">Lane</dt>
          <dd>
            {editing ? (
              <Select
                value={lane ?? 'none'}
                onValueChange={(value) => {
                  const names = (task.tags ?? [])
                    .map((t) => t.name)
                    .filter((n) => !n.startsWith(LANE_TAG_PREFIX));
                  if (value !== 'none') {
                    onPatch({ tags: [...names, `${LANE_TAG_PREFIX}${value}`] });
                  } else {
                    onPatch({ tags: names });
                  }
                }}
              >
                <SelectTrigger className="w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="auto">auto</SelectItem>
                  <SelectItem value="approve">approve</SelectItem>
                  <SelectItem value="full">full</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span
                className="text-[var(--text-2)]"
                title="Review gate — auto: ships without review · approve: needs a human OK · full: independent review + human"
              >
                {lane?.toUpperCase() ?? '—'}
              </span>
            )}
          </dd>
          {linkedDocs.length > 0 ? (
            <>
              <dt className="text-muted-foreground">
                {linkedDocs.length === 1 ? 'Linked doc' : 'Linked docs'}
              </dt>
              <dd className="flex flex-col gap-1">
                {linkedDocs.map((doc) => (
                  <Link
                    key={doc.id}
                    to="/projects/$id/documents/$docId"
                    params={{ id: doc.project_id, docId: doc.id }}
                    onClick={onClose}
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

        <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </div>
        <RichTextEditor
          ref={editorRef}
          value={task.description ?? ''}
          mode={editing ? 'editor' : 'reader'}
          minHeight="5rem"
          ariaLabel="Description"
          projectId={task.project_id}
          seamless={false}
          docLinks={docLinks}
          onCommentOnSelection={(passage) => {
            setPendingPassage(passage);
          }}
        />

        {editing || tags.length > 0 ? (
          <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tags
          </div>
        ) : null}
        <TagEditor
          tags={tags}
          tagSuggestions={tagSuggestions}
          newTag={newTag}
          editing={editing}
          onNewTagChange={setNewTag}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
        />

        <CommentsPanel
          target={{ type: 'task', id: task.id }}
          attachPassage={pendingPassage}
          onPassageConsumed={() => {
            setPendingPassage(null);
          }}
          embedded
        />
      </div>

      {editing ? (
        <footer className="border-t p-3">
          <Button type="button" className="w-full" disabled={isSaving} onClick={handleSave}>
            {isSaving ? 'Saving…' : 'Save details'}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

type TagEditorProps = {
  tags: SerializedTag[];
  tagSuggestions: string[];
  newTag: string;
  editing: boolean;
  onNewTagChange: (value: string) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
};

function TagEditor({
  tags,
  tagSuggestions,
  newTag,
  editing,
  onNewTagChange,
  onAddTag,
  onRemoveTag,
}: TagEditorProps) {
  return (
    <>
      {tags.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {tags.map((tag) => (
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
            onNewTagChange('');
          }}
        >
          <Input
            id="task-drawer-tags"
            aria-label="Tags"
            list="task-drawer-tag-options"
            value={newTag}
            placeholder="Add tag"
            onChange={(event) => {
              onNewTagChange(event.target.value);
            }}
          />
          <datalist id="task-drawer-tag-options">
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
  );
}

function shortId(id: string): string {
  return id.length <= 4 ? id : id.slice(-4).toUpperCase();
}
