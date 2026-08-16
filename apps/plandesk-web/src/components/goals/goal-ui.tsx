import { CheckIcon, CircleIcon, XIcon } from 'lucide-react';
import { badgeVariants } from '@/components/ui/badge';
import type { GoalStatus, SerializedLastVerification } from '../../lib/api.js';
import { cn } from '@/lib/utils';

const goalStatusTokenVars = {
  active: { bg: 'var(--s-todo-bg)', fg: 'var(--s-todo-fg)', dot: 'var(--s-todo-dot)' },
  paused: { bg: 'var(--s-prog-bg)', fg: 'var(--s-prog-fg)', dot: 'var(--s-prog-dot)' },
  complete: { bg: 'var(--s-done-bg)', fg: 'var(--s-done-fg)', dot: 'var(--s-done-dot)' },
  blocked: { bg: 'var(--destructive)', fg: 'var(--primary-foreground)', dot: 'var(--destructive)' },
} as const satisfies Record<GoalStatus, { bg: string; fg: string; dot: string }>;

const goalStatusLabels: Record<GoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  complete: 'Complete',
  blocked: 'Blocked',
};

export function GoalStatusBadge({ status, className }: { status: GoalStatus; className?: string }) {
  const vars = goalStatusTokenVars[status];
  return (
    <span
      data-slot="badge"
      data-goal-status={status}
      className={cn(
        badgeVariants({ variant: 'secondary' }),
        'border-transparent gap-1.5 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
        className,
      )}
      style={{ backgroundColor: vars.bg, color: vars.fg }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: vars.dot }} />
      {goalStatusLabels[status]}
    </span>
  );
}

export function AcceptanceIndicator({
  verification,
}: {
  verification: SerializedLastVerification | null;
}) {
  if (verification === null) {
    return (
      <CircleIcon className="size-3.5 text-muted-foreground" aria-label="acceptance unknown" />
    );
  }
  if (verification.green) {
    return (
      <CheckIcon className="size-3.5 text-[var(--s-done-fg)]" aria-label="acceptance passed" />
    );
  }
  return <XIcon className="size-3.5 text-destructive" aria-label="acceptance failed" />;
}

export function AcceptanceGateChip({
  verification,
}: {
  verification: SerializedLastVerification | null;
}) {
  if (verification === null) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        data-acceptance="unknown"
      >
        <AcceptanceIndicator verification={verification} />
        <span>No verification recorded yet</span>
      </div>
    );
  }

  const passed = verification.green;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        passed
          ? 'border-[var(--s-done-dot)]/30 bg-[var(--s-done-bg)] text-[var(--s-done-fg)]'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
      data-acceptance={passed ? 'passed' : 'failed'}
    >
      <AcceptanceIndicator verification={verification} />
      <span>
        {passed ? 'Passed' : 'Failed'}
        {verification.detail !== undefined ? ` — ${verification.detail}` : ''}{' '}
        <span className="text-xs opacity-80">({new Date(verification.at).toLocaleString()})</span>
      </span>
    </div>
  );
}
