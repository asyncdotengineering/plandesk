import type { ClientViewTask } from '../../lib/portal.js';

type PortalTaskCardProps = {
  task: ClientViewTask;
};

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PortalTaskCard({ task }: PortalTaskCardProps) {
  return (
    <div
      data-task-id={task.id}
      data-task-status={task.status}
      style={{
        padding: '0.75rem',
        borderRadius: 6,
        border: '1px solid #d1d5db',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.3 }}>{task.label}</div>
      {task.due_date !== null ? (
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          Due {formatDueDate(task.due_date)}
        </div>
      ) : null}
      {task.assignee !== undefined && task.assignee !== null ? (
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
          {task.assignee}
        </div>
      ) : null}
      {task.description !== undefined && task.description !== null && task.description !== '' ? (
        <p style={{ fontSize: '0.75rem', color: '#4b5563', margin: '0.375rem 0 0' }}>
          {task.description}
        </p>
      ) : null}
    </div>
  );
}
