import { taskStatuses, type TaskStatus } from '../../lib/api.js';
import { StatusChip } from '../board/StatusChip.js';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { ClientViewTask } from '../../lib/portal.js';

type PortalTaskCardProps = {
  task: ClientViewTask;
};

function isTaskStatus(status: string): status is TaskStatus {
  return (taskStatuses as readonly string[]).includes(status);
}

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PortalTaskCard({ task }: PortalTaskCardProps) {
  return (
    <Card data-task-id={task.id} data-task-status={task.status} className="gap-0 p-3 shadow-sm">
      <div className="mb-2">
        {isTaskStatus(task.status) ? (
          <StatusChip status={task.status} className="pointer-events-none" tabIndex={-1} />
        ) : (
          <Badge variant="secondary" className="text-[10.5px]">
            {task.status.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>
      <div className="text-[13px] font-semibold leading-snug">{task.label}</div>
      {task.due_date !== null ? (
        <div className="mt-1 text-xs text-muted-foreground">Due {formatDueDate(task.due_date)}</div>
      ) : null}
      {task.assignee !== undefined && task.assignee !== null ? (
        <div className="mt-1 text-xs text-muted-foreground">{task.assignee}</div>
      ) : null}
      {task.description !== undefined && task.description !== null && task.description !== '' ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{task.description}</p>
      ) : null}
    </Card>
  );
}
