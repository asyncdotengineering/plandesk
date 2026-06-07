import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';
import type { SerializedTask } from '../../lib/api.js';

type TaskCardProps = {
  task: SerializedTask;
  isDragging?: boolean;
};

export function TaskCard({ task, isDragging = false }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
    data: { status: task.status },
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    padding: '0.75rem',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.06)',
    cursor: 'grab',
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      data-task-status={task.status}
      style={style}
      {...listeners}
      {...attributes}
    >
      <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{task.label}</div>
      {task.assignee !== null ? (
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          {task.assignee}
        </div>
      ) : null}
    </div>
  );
}
