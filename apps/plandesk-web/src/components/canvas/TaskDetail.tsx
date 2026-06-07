import { useEffect, useState } from 'react';
import type { TaskStatus } from '../../lib/api.js';
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
  isSaving?: boolean;
};

export function TaskDetail({ taskId, data, onPatch, onDelete, isSaving = false }: TaskDetailProps) {
  const [description, setDescription] = useState(data.description ?? '');
  const [assignee, setAssignee] = useState(data.assignee ?? '');
  const [dueDate, setDueDate] = useState(data.dueDate !== null ? data.dueDate.slice(0, 10) : '');

  useEffect(() => {
    setDescription(data.description ?? '');
    setAssignee(data.assignee ?? '');
    setDueDate(data.dueDate !== null ? data.dueDate.slice(0, 10) : '');
  }, [taskId, data.description, data.assignee, data.dueDate]);

  const handleSave = () => {
    onPatch({
      description: description.trim() === '' ? null : description,
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
        width: 280,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '1rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151' }}>
        Task details
      </h3>

      <label
        htmlFor={`task-desc-${taskId}`}
        style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}
      >
        Description
      </label>
      <textarea
        id={`task-desc-${taskId}`}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        rows={3}
        style={{
          width: '100%',
          marginBottom: '0.75rem',
          padding: '0.5rem',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: '0.875rem',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />

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
    </aside>
  );
}
