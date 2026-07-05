import { useEffect, useRef, useState } from 'react';
import type { SerializedTag, TaskStatus } from '../../lib/api.js';
import { CommentsPanel } from '../docs/CommentsPanel.js';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';
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
  // Tag editing is rendered only when these are provided (board detail panel).
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
  const [pendingPassage, setPendingPassage] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    setLabel(data.label);
    setAssignee(data.assignee ?? '');
    setDueDate(data.dueDate !== null ? data.dueDate.slice(0, 10) : '');
    setNewTag('');
    setPendingPassage(null);
  }, [taskId, data.label, data.assignee, data.dueDate]);

  const handleSave = () => {
    const trimmedLabel = label.trim();
    const handle = editorRef.current;
    // Only re-serialize the description when the user actually edited it. Task
    // descriptions are Markdown the MCP reads/writes; the rich round-trip is
    // intentionally lossy vs. raw Markdown, so an untouched description is left
    // exactly as the agent authored it. When edited, serialize back to Markdown,
    // never HTML.
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
  };

  const handleDelete = () => {
    if (confirm('Delete this task? Connected edges will be removed.')) {
      onDelete();
    }
  };

  return (
    <aside
      aria-label="Task details"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        width: 320,
        maxHeight: 'calc(100vh - 2rem)',
        overflowY: 'auto',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '1rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '0.875rem', color: '#374151' }}>Task details</h3>
        {onClose !== undefined ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            style={{
              border: 'none',
              background: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '1rem',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      <label
        htmlFor={`task-label-${taskId}`}
        style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}
      >
        Label
      </label>
      <input
        id={`task-label-${taskId}`}
        type="text"
        value={label}
        onChange={(event) => {
          setLabel(event.target.value);
        }}
        style={{
          width: '100%',
          marginBottom: '0.75rem',
          padding: '0.5rem',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: '0.875rem',
          fontWeight: 600,
          boxSizing: 'border-box',
        }}
      />

      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
        Description
      </div>
      <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
        <RichTextEditor
          ref={editorRef}
          value={data.description ?? ''}
          mode="editor"
          minHeight="5rem"
          ariaLabel="Description"
          onCommentOnSelection={(passage) => {
            setPendingPassage(passage);
          }}
        />
      </div>

      <label
        htmlFor={`task-assignee-${taskId}`}
        style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}
      >
        Assignee
      </label>
      <input
        id={`task-assignee-${taskId}`}
        type="text"
        value={assignee}
        onChange={(event) => {
          setAssignee(event.target.value);
        }}
        placeholder="Unassigned"
        style={{
          width: '100%',
          marginBottom: '0.75rem',
          padding: '0.5rem',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: '0.875rem',
          boxSizing: 'border-box',
        }}
      />

      <label
        htmlFor={`task-due-${taskId}`}
        style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}
      >
        Due date
      </label>
      <input
        id={`task-due-${taskId}`}
        type="date"
        value={dueDate}
        onChange={(event) => {
          setDueDate(event.target.value);
        }}
        style={{
          width: '100%',
          marginBottom: '0.75rem',
          padding: '0.5rem',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: '0.875rem',
          boxSizing: 'border-box',
        }}
      />

      {onAddTag !== undefined && onRemoveTag !== undefined ? (
        <>
          <label
            htmlFor={`task-tag-input-${taskId}`}
            style={{
              display: 'block',
              fontSize: '0.75rem',
              color: '#6b7280',
              marginBottom: '0.25rem',
            }}
          >
            Tags
          </label>
          {tags !== undefined && tags.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.25rem',
                marginBottom: '0.375rem',
              }}
            >
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: '#374151',
                    background: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: 999,
                    padding: '0.125rem 0.25rem 0.125rem 0.5rem',
                  }}
                >
                  {tag.color !== null ? (
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: tag.color,
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                  {tag.name}
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveTag(tag.name);
                    }}
                    aria-label={`Remove tag ${tag.name}`}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#9ca3af',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      lineHeight: 1,
                      padding: '0 0.125rem',
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = newTag.trim();
              if (trimmed === '') {
                return;
              }
              onAddTag(trimmed);
              setNewTag('');
            }}
            style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }}
          >
            <input
              id={`task-tag-input-${taskId}`}
              type="text"
              value={newTag}
              onChange={(event) => {
                setNewTag(event.target.value);
              }}
              placeholder="Add tag"
              list={`task-tag-options-${taskId}`}
              style={{
                flex: 1,
                padding: '0.375rem 0.5rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: '0.8125rem',
                boxSizing: 'border-box',
                minWidth: 0,
              }}
            />
            <datalist id={`task-tag-options-${taskId}`}>
              {tagSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button
              type="submit"
              disabled={newTag.trim() === ''}
              style={{
                padding: '0.375rem 0.625rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Add tag
            </button>
          </form>
        </>
      ) : null}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          style={{
            flex: 1,
            padding: '0.5rem',
            borderRadius: 6,
            border: '1px solid #1d4ed8',
            background: '#1d4ed8',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: isSaving ? 'wait' : 'pointer',
          }}
        >
          {isSaving ? 'Saving…' : 'Save details'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete task"
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>

      <CommentsPanel
        target={{ type: 'task', id: taskId }}
        attachPassage={pendingPassage}
        onPassageConsumed={() => {
          setPendingPassage(null);
        }}
        embedded
      />
    </aside>
  );
}
