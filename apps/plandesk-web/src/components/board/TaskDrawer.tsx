import { useEffect, useRef, useState } from 'react';
import { FileTextIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import type { RichTextEditorHandle } from '../editor/RichTextEditor.js';
import { RichTextEditor } from '../editor/RichTextEditor.js';
import type { PatchTaskInput, SerializedDocument, SerializedTag, SerializedTask, TaskStatus } from '../../lib/api.js';
import { laneFromTags } from './board-utils.js';
import { StatusMenu } from './StatusChip.js';

type TaskDrawerProps = {
  task: SerializedTask | null;
  linkedDoc?: SerializedDocument;
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
  linkedDoc,
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
        className="w-[400px] gap-0 p-0 sm:max-w-[400px]"
      >
        <SheetTitle className="sr-only">Task details</SheetTitle>
        <SheetDescription className="sr-only">View and edit the task.</SheetDescription>
        {task !== null ? (
          <TaskDrawerBody
            task={task}
            linkedDoc={linkedDoc}
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
  linkedDoc?: SerializedDocument;
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
  linkedDoc,
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
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    setLabel(task.label);
    setNewTag('');
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
  };

  const tags = task.tags ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <StatusMenu status={task.status} onChange={onChangeStatus} />
        <span className="mono text-xs text-muted-foreground">{shortId(task.id)}</span>
        <span className="ml-auto" />
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

        <dl className="grid grid-cols-[92px_1fr] gap-y-2 py-1 text-[12.5px]">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <StatusMenu status={task.status} onChange={onChangeStatus} />
          </dd>
          {lane !== undefined ? (
            <>
              <dt className="text-muted-foreground">Lane</dt>
              <dd className="text-[var(--text-2)]">{lane}</dd>
            </>
          ) : null}
          {linkedDoc !== undefined ? (
            <>
              <dt className="text-muted-foreground">Linked doc</dt>
              <dd className="inline-flex items-center gap-1.5 font-medium">
                <FileTextIcon className="size-3.5 text-muted-foreground" />
                {linkedDoc.title}
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
          mode="editor"
          minHeight="5rem"
          ariaLabel="Description"
        />

        <Label htmlFor="task-drawer-tags" className="mb-1 mt-4 text-muted-foreground">
          Tags
        </Label>
        <TagEditor
          tags={tags}
          tagSuggestions={tagSuggestions}
          newTag={newTag}
          onNewTagChange={setNewTag}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
        />
      </div>

      <footer className="border-t p-3">
        <Button type="button" className="w-full" disabled={isSaving} onClick={handleSave}>
          {isSaving ? 'Saving…' : 'Save details'}
        </Button>
      </footer>
    </div>
  );
}

type TagEditorProps = {
  tags: SerializedTag[];
  tagSuggestions: string[];
  newTag: string;
  onNewTagChange: (value: string) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
};

function TagEditor({
  tags,
  tagSuggestions,
  newTag,
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
            </span>
          ))}
        </div>
      ) : null}
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
    </>
  );
}

function shortId(id: string): string {
  return id.length <= 4 ? id : id.slice(-4).toUpperCase();
}
