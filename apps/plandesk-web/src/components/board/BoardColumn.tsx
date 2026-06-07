import { useDroppable } from '@dnd-kit/core';
import type { SerializedTask, TaskStatus } from '../../lib/api.js';
import { columnLabels } from './board-utils.js';
import { TaskCard } from './TaskCard.js';

type BoardColumnProps = {
  status: TaskStatus;
  tasks: SerializedTask[];
  activeTaskId: string | null;
};

export function BoardColumn({ status, tasks, activeTaskId }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      data-board-column={status}
      style={{
        flex: '1 1 0',
        minWidth: 180,
        display: 'flex',
        flexDirection: 'column',
        background: isOver ? '#eff6ff' : '#f9fafb',
        borderRadius: 8,
        border: isOver ? '2px solid #3b82f6' : '1px solid #e5e7eb',
        transition: 'background 0.15s, border 0.15s',
      }}
    >
      <header
        style={{
          padding: '0.75rem',
          fontWeight: 600,
          fontSize: '0.875rem',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{columnLabels[status]}</span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: '#6b7280',
            background: '#e5e7eb',
            borderRadius: 999,
            padding: '0.125rem 0.5rem',
          }}
        >
          {tasks.length}
        </span>
      </header>
      <div
        style={{
          padding: '0.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          flex: 1,
          minHeight: 120,
        }}
      >
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} isDragging={activeTaskId === task.id} />
        ))}
      </div>
    </div>
  );
}
