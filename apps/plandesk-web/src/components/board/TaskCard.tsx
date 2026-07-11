import { FileTextIcon, MoreHorizontalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { columnLabels, laneFromTags, LANE_TAG_PREFIX } from './board-utils.js';
import { StatusMenu } from './StatusChip.js';
import { taskStatuses, type SerializedTask, type TaskStatus } from '../../lib/api.js';

type TaskCardProps = {
  task: SerializedTask;
  hasLinkedDoc: boolean;
  onOpen: () => void;
  onChangeStatus: (status: TaskStatus) => void;
  onRequestDelete: () => void;
};

export function TaskCard({ task, hasLinkedDoc, onOpen, onChangeStatus, onRequestDelete }: TaskCardProps) {
  const lane = laneFromTags(task.tags);
  const chips = (task.tags ?? []).filter((tag) => !tag.name.startsWith(LANE_TAG_PREFIX));

  return (
    <Card
      data-task-id={task.id}
      data-task-status={task.status}
      onClick={onOpen}
      className={cn(
        'group relative w-full cursor-pointer gap-0 rounded-lg px-2.5 py-2.5 shadow-[var(--shadow)] transition',
        'hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]',
      )}
    >
      <div className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Task actions"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                onOpen();
              }}
            >
              Open
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {taskStatuses.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    disabled={status === task.status}
                    onSelect={() => {
                      onChangeStatus(status);
                    }}
                  >
                    {columnLabels[status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onRequestDelete();
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="mb-2 mr-6 text-[13px] font-medium leading-snug">{task.label}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusMenu status={task.status} onChange={onChangeStatus} />
        {lane !== undefined ? (
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            {lane}
          </span>
        ) : null}
        {hasLinkedDoc ? (
          <FileTextIcon className="size-3.5 text-muted-foreground" aria-label="Has linked document" />
        ) : null}
        <span className="mono ml-auto text-[10.5px] text-muted-foreground">{shortId(task.id)}</span>
      </div>

      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((tag) => (
            <span
              key={tag.id}
              data-tag-chip={tag.name}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
            >
              {tag.color !== null ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              ) : null}
              {tag.name}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function shortId(id: string): string {
  return id.length <= 4 ? id : id.slice(-4).toUpperCase();
}
