import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { boardColumnOrder, columnLabels } from '../board/board-utils.js';
import { statusTokenVars } from '../board/StatusChip.js';
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

function columnDotColor(status: string): string {
  if (status in statusTokenVars) {
    return statusTokenVars[status as keyof typeof statusTokenVars].dot;
  }
  return 'var(--muted-foreground)';
}

export function PortalBoard({ tasks }: PortalBoardProps) {
  const grouped = useMemo(() => groupPortalTasksByStatus(tasks), [tasks]);
  const statuses = useMemo(() => columnOrder(grouped), [grouped]);

  return (
    <div className="flex items-start gap-3 overflow-x-auto" data-portal-board>
      {statuses.map((status) => {
        const columnTasks = grouped.get(status) ?? [];
        return (
          <div
            key={status}
            data-portal-column={status}
            className="flex min-w-[180px] flex-1 flex-col rounded-lg border border-border bg-muted/40"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: columnDotColor(status) }}
                />
                {columnLabel(status)}
              </span>
              <Badge variant="secondary" className="h-5 px-2 text-[11px] font-medium">
                {columnTasks.length}
              </Badge>
            </header>
            <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
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