import { useDraggable } from '@dnd-kit/core';
import { FileTextIcon, MoreHorizontalIcon } from 'lucide-react';
import { type MouseEvent, useRef } from 'react';
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
import { taskStatuses, type SerializedTask, type TaskStatus } from '../../lib/api.js';
import { BlockedIndicator } from './BlockedIndicator.js';
import { columnLabels, laneFromTags, LANE_TAG_PREFIX } from './board-utils.js';
import { StatusChip, StatusMenu } from './StatusChip.js';

type TaskCardProps = {
  task: SerializedTask;
  hasLinkedDoc: boolean;
  onOpen: () => void;
  onChangeStatus: (status: TaskStatus) => void;
  onRequestDelete: () => void;
};

// A drag and a click both terminate on the card; only treat it as an open when
// the pointer barely moved between press and release (matches the MouseSensor
// activation distance, so a real drag never opens the drawer). A touch tap
// records no start point and falls through to open, which is what a tap means.
const DRAG_CLICK_TOLERANCE_PX = 6;

export function TaskCard({
  task,
  hasLinkedDoc,
  onOpen,
  onChangeStatus,
  onRequestDelete,
}: TaskCardProps) {
  const lane = laneFromTags(task.tags);
  const chips = (task.tags ?? []).filter((tag) => !tag.name.startsWith(LANE_TAG_PREFIX));

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
  });
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (
      start !== null &&
      (Math.abs(event.clientX - start.x) > DRAG_CLICK_TOLERANCE_PX ||
        Math.abs(event.clientY - start.y) > DRAG_CLICK_TOLERANCE_PX)
    ) {
      return;
    }
    onOpen();
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    pointerDown.current = { x: event.clientX, y: event.clientY };
    listeners?.onMouseDown?.(event);
  };

  return (
    <Card
      ref={setNodeRef}
      data-task-id={task.id}
      data-task-status={task.status}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onTouchStart={(event) => {
        listeners?.onTouchStart?.(event);
      }}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
      }}
      {...attributes}
      // `none` here disabled scrolling over every card, which on a phone is
      // most of the board. TouchSensor holds the gesture with a non-passive
      // touchmove listener once the press-and-hold activates, so the browser
      // only needs to be told to skip the double-tap-zoom delay.
      style={{ touchAction: 'manipulation' }}
      className={cn(
        'group relative w-full cursor-pointer gap-0 rounded-lg px-2.5 py-2.5 shadow-[var(--shadow)] transition',
        'hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]',
        isDragging && 'opacity-40',
      )}
    >
      <div className="absolute right-1.5 top-1.5 opacity-100 transition">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Task actions"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onTouchStart={(event) => {
                event.stopPropagation();
              }}
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
        <BlockedIndicator blocked={task.blocked} waitingOn={task.waiting_on} />
        {lane !== undefined ? (
          <span
            className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
            title="Review gate — auto: ships without review · approve: needs a human OK · full: independent review + human"
          >
            {lane}
          </span>
        ) : null}
        {hasLinkedDoc ? (
          <FileTextIcon
            className="size-3.5 text-muted-foreground"
            aria-label="Has linked document"
          />
        ) : null}
        <span
          className="mono ml-auto text-[10.5px] text-muted-foreground"
          title="Short ID — last 4 characters of this task's ID, for quick reference"
        >
          {shortId(task.id)}
        </span>
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

// Floating preview rendered inside <DragOverlay>. Deliberately a separate,
// hook-free component so the dragged id is never registered twice with dnd-kit.
export function TaskCardPreview({
  task,
  hasLinkedDoc,
}: {
  task: SerializedTask;
  hasLinkedDoc: boolean;
}) {
  const lane = laneFromTags(task.tags);
  return (
    // The drag preview must match the card it lifted off, which is the width of
    // its column — 86vw on a phone, the fixed track at tablet and up.
    <Card className="w-[86vw] gap-0 rounded-lg px-2.5 py-2.5 shadow-[var(--shadow-pop)] md:w-[258px]">
      <p className="mb-2 mr-6 text-[13px] font-medium leading-snug">{task.label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip status={task.status} tabIndex={-1} />
        <BlockedIndicator blocked={task.blocked} waitingOn={task.waiting_on} />
        {lane !== undefined ? (
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            {lane}
          </span>
        ) : null}
        {hasLinkedDoc ? (
          <FileTextIcon className="size-3.5 text-muted-foreground" aria-hidden />
        ) : null}
        <span className="mono ml-auto text-[10.5px] text-muted-foreground">{shortId(task.id)}</span>
      </div>
    </Card>
  );
}

function shortId(id: string): string {
  return id.length <= 4 ? id : id.slice(-4).toUpperCase();
}
