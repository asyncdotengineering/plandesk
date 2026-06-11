import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useState, type MouseEvent } from 'react';
import { taskStatuses, type TaskStatus } from '../../lib/api.js';
import type { TaskNodeData } from './canvas-map.js';
import { OpenDocLink } from './OpenDocLink.js';

const statusStyles: Record<TaskStatus, { bg: string; color: string }> = {
  scope: { bg: '#ede9fe', color: '#5b21b6' },
  todo: { bg: '#dbeafe', color: '#1d4ed8' },
  in_progress: { bg: '#fef3c7', color: '#b45309' },
  done: { bg: '#dcfce7', color: '#15803d' },
  backlog: { bg: '#f3f4f6', color: '#4b5563' },
};

type TaskNodeCallbacks = {
  onPatchLabel: (taskId: string, label: string) => void;
  onPatchStatus: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
};

let taskNodeCallbacks: TaskNodeCallbacks | null = null;

export function registerTaskNodeCallbacks(callbacks: TaskNodeCallbacks | null) {
  taskNodeCallbacks = callbacks;
}

export function TaskNode({ id, data }: NodeProps<Node<TaskNodeData>>) {
  const badge = statusStyles[data.status];
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(data.label);

  useEffect(() => {
    setLabelDraft(data.label);
  }, [data.label]);

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed === '' || trimmed === data.label) {
      setLabelDraft(data.label);
      setEditing(false);
      return;
    }
    taskNodeCallbacks?.onPatchLabel(id, trimmed);
    setEditing(false);
  };

  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    if (confirm('Delete this task? Connected edges will be removed.')) {
      taskNodeCallbacks?.onDelete(id);
    }
  };

  return (
    <div
      style={{
        minWidth: 160,
        padding: '0.75rem 1rem',
        borderRadius: 8,
        border: '1px solid #d1d5db',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        cursor: 'grab',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.25rem',
          marginBottom: '0.5rem',
        }}
      >
        {editing ? (
          <input
            className="nodrag"
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
                setLabelDraft(data.label);
                setEditing(false);
              }
            }}
            aria-label="Task label"
            style={{
              flex: 1,
              fontWeight: 600,
              fontSize: '0.875rem',
              border: '1px solid #93c5fd',
              borderRadius: 4,
              padding: '0.125rem 0.375rem',
            }}
          />
        ) : (
          <button
            className="nodrag"
            type="button"
            onClick={() => {
              setEditing(true);
            }}
            style={{
              flex: 1,
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
            {data.label}
          </button>
        )}
        <button
          className="nodrag"
          type="button"
          onClick={handleDelete}
          aria-label="Delete task"
          title="Delete task"
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
      <select
        className="nodrag"
        value={data.status}
        onChange={(event) => {
          taskNodeCallbacks?.onPatchStatus(id, event.target.value as TaskStatus);
        }}
        aria-label="Task status"
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          padding: '0.125rem 0.375rem',
          borderRadius: 999,
          background: badge.bg,
          color: badge.color,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {taskStatuses.map((status) => (
          <option key={status} value={status}>
            {status.replace('_', ' ')}
          </option>
        ))}
      </select>
      {data.documentId !== undefined ? (
        <div className="nodrag" style={{ marginTop: '0.5rem' }}>
          <OpenDocLink projectId={data.projectId} documentId={data.documentId} />
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
