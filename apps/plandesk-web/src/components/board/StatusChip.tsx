import { type ComponentPropsWithoutRef } from 'react';
import { badgeVariants } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { taskStatuses, type TaskStatus } from '../../lib/api.js';
import { columnLabels } from './board-utils.js';

// Status palette lives on raw --s-* tokens (separate from the shadcn accent)
// so the board columns and chips share one source of truth for color.
export const statusTokenVars = {
  scope: { bg: 'var(--s-scope-bg)', fg: 'var(--s-scope-fg)', dot: 'var(--s-scope-dot)' },
  todo: { bg: 'var(--s-todo-bg)', fg: 'var(--s-todo-fg)', dot: 'var(--s-todo-dot)' },
  in_progress: { bg: 'var(--s-prog-bg)', fg: 'var(--s-prog-fg)', dot: 'var(--s-prog-dot)' },
  done: { bg: 'var(--s-done-bg)', fg: 'var(--s-done-fg)', dot: 'var(--s-done-dot)' },
  backlog: { bg: 'var(--s-back-bg)', fg: 'var(--s-back-fg)', dot: 'var(--s-back-dot)' },
} as const satisfies Record<TaskStatus, { bg: string; fg: string; dot: string }>;

const statusChipClasses = cn(
  badgeVariants({ variant: 'secondary' }),
  // touch-target only where the chip is interactive; the 17px-tall pill is the
  // status MENU on a card, and it is one of the most-used controls on the board.
  'touch-target border-transparent gap-1.5 px-2 py-0.5 text-[10.5px] font-medium leading-none',
);

export function StatusChip({
  status,
  className,
  ...props
}: { status: TaskStatus } & ComponentPropsWithoutRef<'button'>) {
  const vars = statusTokenVars[status];
  return (
    <button
      type="button"
      data-slot="badge"
      data-status={status}
      className={cn(statusChipClasses, className)}
      style={{ backgroundColor: vars.bg, color: vars.fg }}
      {...props}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: vars.dot }} />
      {columnLabels[status]}
    </button>
  );
}

// Clickable chip that opens a menu of every status. Used on the card meta row
// and inside the task drawer. Selecting re-patches the task's status.
export function StatusMenu({
  status,
  onChange,
  align = 'start',
  className,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  align?: ComponentPropsWithoutRef<typeof DropdownMenuContent>['align'];
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusChip
          status={status}
          className={className}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {taskStatuses.map((option) => (
          <DropdownMenuItem
            key={option}
            className="gap-2"
            data-status={option}
            onSelect={() => {
              onChange(option);
            }}
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: statusTokenVars[option].dot }}
            />
            {columnLabels[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
