import { useMemo } from 'react';
import { boardColumnOrder, columnLabels } from '../board/board-utils.js';
import type { ClientViewTask } from '../../lib/portal.js';
import { PortalTaskCard } from './PortalTaskCard.js';

type PortalBoardProps = {
  tasks: ClientViewTask[];
};

function groupPortalTasksByStatus(tasks: ClientViewTask[]): Map<string, ClientViewTask[]> {
  const grouped = new Map<string, ClientViewTask[]>();

  for (const status of boardColumnOrder) {
    grouped.set(status, []);
  }

  for (const task of tasks) {
    const bucket = grouped.get(task.status);
    if (bucket !== undefined) {
      bucket.push(task);
      continue;
    }
    const existing = grouped.get(task.status) ?? [];
    existing.push(task);
    grouped.set(task.status, existing);
  }

  return grouped;
}

function columnOrder(grouped: Map<string, ClientViewTask[]>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  for (const status of boardColumnOrder) {
    if (grouped.has(status)) {
      order.push(status);
      seen.add(status);
    }
  }

  for (const status of grouped.keys()) {
    if (!seen.has(status)) {
      order.push(status);
    }
  }

  return order;
}

function columnLabel(status: string): string {
  if (status in columnLabels) {
    return columnLabels[status as keyof typeof columnLabels];
  }
  return status.replace(/_/g, ' ');
}

export function PortalBoard({ tasks }: PortalBoardProps) {
  const grouped = useMemo(() => groupPortalTasksByStatus(tasks), [tasks]);
  const statuses = useMemo(() => columnOrder(grouped), [grouped]);

  return (
    <div
      style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', overflowX: 'auto' }}
      data-portal-board
    >
      {statuses.map((status) => {
        const columnTasks = grouped.get(status) ?? [];
        return (
          <div
            key={status}
            data-portal-column={status}
            style={{
              flex: '1 1 0',
              minWidth: 180,
              display: 'flex',
              flexDirection: 'column',
              background: '#f9fafb',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
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
              <span>{columnLabel(status)}</span>
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
                {columnTasks.length}
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
              {columnTasks.map((task) => (
                <PortalTaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
