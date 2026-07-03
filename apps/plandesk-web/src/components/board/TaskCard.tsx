import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useRef, type CSSProperties, type MouseEvent } from 'react';
import type { SerializedTask } from '../../lib/api.js';

type TaskCardProps = {
  task: SerializedTask;
  isDragging?: boolean;
  onOpen: (taskId: string) => void;
  onDelete: (taskId: string) => void;
};

const DRAG_CLICK_TOLERANCE_PX = 5;

export function TaskCard({ task, isDragging = false, onOpen, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
    data: { status: task.status },
  });
  const pointerDownPosition = useRef<{ x: number; y: number } | null>(null);

  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    if (confirm('Delete this task?')) {
      onDelete(task.id);
    }
  };

  // A drag releases a click on the same element; only open when the pointer
  // barely moved between press and release.
  const handleClick = (event: MouseEvent) => {
    const start = pointerDownPosition.current;
    if (
      start !== null &&
      (Math.abs(event.clientX - start.x) > DRAG_CLICK_TOLERANCE_PX ||
        Math.abs(event.clientY - start.y) > DRAG_CLICK_TOLERANCE_PX)
    ) {
      return;
    }
    onOpen(task.id);
  };

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    padding: '0.75rem',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.06)',
    cursor: isDragging ? 'grabbing' : 'pointer',
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      data-task-status={task.status}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        pointerDownPosition.current = { x: event.clientX, y: event.clientY };
        listeners?.onPointerDown?.(event);
      }}
      onClick={handleClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.25rem' }}>
        <div style={{ flex: 1, fontWeight: 600, lineHeight: 1.3 }}>{task.label}</div>
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
      {task.tags !== undefined && task.tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.375rem' }}>
          {task.tags.map((tag) => (
            <span
              key={tag.id}
              data-tag-chip={tag.name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.6875rem',
                fontWeight: 500,
                color: '#374151',
                background: '#f3f4f6',
                border: '1px solid #e5e7eb',
                borderRadius: 999,
                padding: '0.0625rem 0.5rem',
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
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
