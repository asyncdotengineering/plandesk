import { useDndContext, useDroppable } from '@dnd-kit/core';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SerializedTask, TaskStatus } from '../../lib/api.js';
import { columnLabels } from './board-utils.js';
import { statusTokenVars } from './StatusChip.js';
import { TaskCard } from './TaskCard.js';

type BoardColumnProps = {
  status: TaskStatus;
  tasks: SerializedTask[];
  linkedDocTaskIds: Set<string>;
  onOpenTask: (taskId: string) => void;
  onChangeStatus: (taskId: string, status: TaskStatus) => void;
  onRequestDelete: (taskId: string) => void;
  onAddTask: (status: TaskStatus) => void;
};

const EMPTY_COPY: Record<TaskStatus, { title: string; body: string }> = {
  scope: {
    title: 'Nothing in scope',
    body: 'Ideas awaiting sizing land here before a human releases them.',
  },
  todo: { title: 'No todos', body: 'Tasks waiting to start show up here.' },
  in_progress: { title: 'Quiet for now', body: 'Nothing actively in progress.' },
  done: { title: 'Nothing done yet', body: 'Completed tasks collect here.' },
  backlog: {
    title: 'Backlog is clear',
    body: 'Unshaped requests wait here until triage sorts them.',
  },
};

export function BoardColumn({
  status,
  tasks,
  linkedDocTaskIds,
  onOpenTask,
  onChangeStatus,
  onRequestDelete,
  onAddTask,
}: BoardColumnProps) {
  const label = columnLabels[status];
  const empty = EMPTY_COPY[status];

  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { active } = useDndContext();
  // Only highlight columns that would actually accept the card (a different
  // column than the drag source). Same-column drops are no-ops.
  const draggedStatus = active?.data.current?.status as TaskStatus | undefined;
  const isDropTarget = isOver && draggedStatus !== undefined && draggedStatus !== status;

  return (
    <section
      ref={setNodeRef}
      data-board-column={status}
      className={cn(
        // Below the tablet breakpoint a column takes almost the whole screen
        // and snaps, so a swipe moves one column at a time. The 14vw left over
        // is the peek that tells you another column is there.
        'flex w-[86vw] flex-shrink-0 snap-start flex-col rounded-lg transition-colors md:w-[274px]',
        isDropTarget && 'bg-muted/50 ring-2 ring-ring/30',
      )}
    >
      <header className="flex items-center gap-2 px-1 pb-2.5">
        <span
          aria-hidden
          className="size-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: statusTokenVars[status].dot }}
        />
        <span className="text-[12.5px] font-semibold">{label}</span>
        <span className="mono rounded-full bg-secondary px-1.5 text-[11.5px] text-muted-foreground">
          {tasks.length}
        </span>
        <span className="ml-auto" />
        <Button
          type="button"
          data-add-task
          variant="ghost"
          size="icon-xs"
          aria-label={`Add task to ${label}`}
          onClick={() => {
            onAddTask(status);
          }}
        >
          <PlusIcon />
        </Button>
      </header>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-0.5 pb-2">
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-4 text-center text-xs text-muted-foreground">
            <p className="font-semibold text-[var(--text-2)]">{empty.title}</p>
            <p className="mt-0.5 leading-snug">{empty.body}</p>
          </div>
        ) : (
          <>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                hasLinkedDoc={linkedDocTaskIds.has(task.id)}
                onOpen={() => {
                  onOpenTask(task.id);
                }}
                onChangeStatus={(next) => {
                  onChangeStatus(task.id, next);
                }}
                onRequestDelete={() => {
                  onRequestDelete(task.id);
                }}
              />
            ))}
            <button
              type="button"
              data-add-task
              onClick={() => {
                onAddTask(status);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground',
                'hover:bg-secondary hover:text-foreground',
              )}
            >
              <PlusIcon className="size-3.5" />
              Add task
            </button>
          </>
        )}
      </div>
    </section>
  );
}
