import { useState, type SubmitEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { SerializedTask, TaskStatus } from '../../lib/api.js';
import { columnLabels } from './board-utils.js';
import { TaskCard } from './TaskCard.js';

type BoardColumnProps = {
  status: TaskStatus;
  tasks: SerializedTask[];
  activeTaskId: string | null;
  onAddTask: (status: TaskStatus, label: string) => void;
  onOpenTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  isAdding?: boolean;
};

export function BoardColumn({
  status,
  tasks,
  activeTaskId,
  onAddTask,
  onOpenTask,
  onDeleteTask,
  isAdding = false,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [label, setLabel] = useState('');
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === '') {
      return;
    }
    onAddTask(status, trimmed);
    setLabel('');
    setShowForm(false);
  };

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
          <TaskCard
            key={task.id}
            task={task}
            isDragging={activeTaskId === task.id}
            onOpen={onOpenTask}
            onDelete={onDeleteTask}
          />
        ))}
        {showForm ? (
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}
          >
            <input
              type="text"
              value={label}
              autoFocus
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              placeholder="Task name"
              aria-label={`New task in ${columnLabels[status]}`}
              style={{
                padding: '0.375rem 0.5rem',
                borderRadius: 4,
                border: '1px solid #d1d5db',
                fontSize: '0.875rem',
              }}
            />
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button
                type="submit"
                disabled={isAdding || label.trim() === ''}
                style={{
                  flex: 1,
                  padding: '0.25rem 0.5rem',
                  borderRadius: 4,
                  border: '1px solid #1d4ed8',
                  background: '#1d4ed8',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: isAdding ? 'wait' : 'pointer',
                }}
              >
                {isAdding ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setLabel('');
                }}
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
            }}
            style={{
              padding: '0.375rem',
              borderRadius: 4,
              border: '1px dashed #d1d5db',
              background: 'transparent',
              color: '#6b7280',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            + Add task
          </button>
        )}
      </div>
    </div>
  );
}
