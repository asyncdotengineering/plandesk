import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import type { SerializedTask } from '../../lib/api.js';

type TaskCardProps = {
  task: SerializedTask;
  isDragging?: boolean;
  onPatchLabel: (taskId: string, label: string) => void;
  onDelete: (taskId: string) => void;
};

export function TaskCard({ task, isDragging = false, onPatchLabel, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
    data: { status: task.status },
  });
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(task.label);

  useEffect(() => {
    setLabelDraft(task.label);
  }, [task.label]);

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed === '' || trimmed === task.label) {
      setLabelDraft(task.label);
      setEditing(false);
      return;
    }
    onPatchLabel(task.id, trimmed);
    setEditing(false);
  };

  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    if (confirm('Delete this task?')) {
      onDelete(task.id);
    }
  };

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    padding: '0.75rem',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.06)',
    cursor: editing ? 'default' : 'grab',
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  return (
    <div ref={setNodeRef} data-task-id={task.id} data-task-status={task.status} style={style}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.25rem' }}>
        <div style={{ flex: 1 }} {...(editing ? {} : listeners)} {...(editing ? {} : attributes)}>
          {editing ? (
            <input
              type="text"
              value={labelDraft}
              autoFocus
              onChange={(event) => {
                setLabelDraft(event.target.value);
              }}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitLabel();
                }
                if (event.key === 'Escape') {
                  setLabelDraft(task.label);
                  setEditing(false);
                }
              }}
              aria-label="Task label"
              style={{
                width: '100%',
                fontWeight: 600,
                fontSize: '0.875rem',
                border: '1px solid #93c5fd',
                borderRadius: 4,
                padding: '0.125rem 0.375rem',
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                fontWeight: 600,
                lineHeight: 1.3,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'text',
                fontSize: 'inherit',
                color: 'inherit',
              }}
            >
              {task.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete task"
          style={{
            border: 'none',
            background: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: '1rem',
            lineHeight: 1,
            padding: '0 0.125rem',
          }}
        >
          ×
        </button>
      </div>
      {task.assignee !== null ? (
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          {task.assignee}
        </div>
      ) : null}
    </div>
  );
}
