import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { TaskNodeData } from './canvas-map.js';

const statusStyles: Record<TaskNodeData['status'], { bg: string; color: string }> = {
  scope: { bg: '#ede9fe', color: '#5b21b6' },
  todo: { bg: '#dbeafe', color: '#1d4ed8' },
  in_progress: { bg: '#fef3c7', color: '#b45309' },
  done: { bg: '#dcfce7', color: '#15803d' },
  backlog: { bg: '#f3f4f6', color: '#4b5563' },
};

export function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  const badge = statusStyles[data.status];

  return (
    <div
      style={{
        minWidth: 160,
        padding: '0.75rem 1rem',
        borderRadius: 8,
        border: '1px solid #d1d5db',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600, marginBottom: '0.5rem', lineHeight: 1.3 }}>{data.label}</div>
      <span
        style={{
          display: 'inline-block',
          fontSize: '0.75rem',
          fontWeight: 600,
          padding: '0.125rem 0.5rem',
          borderRadius: 999,
          background: badge.bg,
          color: badge.color,
        }}
      >
        {data.status.replace('_', ' ')}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
