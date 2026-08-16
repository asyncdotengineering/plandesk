import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAgentRuns } from '../../lib/queries.js';
import type { SerializedAgentRun } from '../../lib/api.js';

type AgentRunsPanelProps = {
  projectId: string;
  className?: string;
};

const runStatusVars: Record<SerializedAgentRun['status'], { bg: string; fg: string }> = {
  running: { bg: 'var(--s-prog-bg)', fg: 'var(--s-prog-fg)' },
  completed: { bg: 'var(--s-done-bg)', fg: 'var(--s-done-fg)' },
  failed: { bg: 'var(--destructive)', fg: '#ffffff' },
};

function formatStatus(status: SerializedAgentRun['status']): string {
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'completed') {
    return 'Completed';
  }
  return 'Failed';
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return String(minutes) + 'm ago';
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return String(hours) + 'h ago';
  }
  const days = Math.round(hours / 24);
  return String(days) + 'd ago';
}

function activityAvatar(run: SerializedAgentRun): { label: string; bg: string; fg: string } {
  const vars = runStatusVars[run.status];
  const label = run.label ?? 'Agent run';
  return {
    label: label.charAt(0).toUpperCase(),
    bg: vars.bg,
    fg: vars.fg,
  };
}

export function AgentRunsPanel({ projectId, className }: AgentRunsPanelProps) {
  const { data: runs, isLoading, error } = useAgentRuns(projectId);

  return (
    <aside
      aria-label="Agents activity"
      className={cn(
        'absolute inset-0 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-3">
        <h2 className="text-[12.5px] font-semibold">Agents activity</h2>
        {runs !== undefined && runs.length > 0 ? (
          <span className="ml-auto text-[11px] text-muted-foreground">{runs.length} runs</span>
        ) : null}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-4">
          {isLoading ? (
            <p className="px-0.5 py-2.5 text-[12px] text-muted-foreground">Loading…</p>
          ) : null}
          {error !== null ? (
            <p role="alert" className="px-0.5 py-2.5 text-[12px] text-destructive">
              Failed to load agent runs
            </p>
          ) : null}
          {!isLoading && error === null && runs !== undefined && runs.length === 0 ? (
            <p className="px-0.5 py-2.5 text-[12px] text-muted-foreground">No agent runs yet.</p>
          ) : null}
          {runs?.map((run, index) => {
            const avatar = activityAvatar(run);
            return (
              <article
                key={run.id}
                className={cn('flex gap-2.5 py-2.5', index !== 0 && 'border-t border-border')}
              >
                <span
                  aria-hidden
                  className="mt-px flex size-[22px] shrink-0 select-none items-center justify-center rounded-md text-[10px] font-semibold"
                  style={{ backgroundColor: avatar.bg, color: avatar.fg }}
                >
                  {avatar.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[12px] font-semibold">{run.label ?? 'Agent run'}</span>
                    <Badge
                      className="rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-[0.05em]"
                      style={{
                        backgroundColor: runStatusVars[run.status].bg,
                        color: runStatusVars[run.status].fg,
                      }}
                    >
                      {formatStatus(run.status)}
                    </Badge>
                    <span className="ml-auto text-[10.5px] text-muted-foreground">
                      {relativeTime(run.started_at)}
                    </span>
                  </div>
                  {run.events.length > 0 ? (
                    <ul className="space-y-0.5">
                      {run.events.map((event) => (
                        <li
                          key={event.id}
                          className="text-[11.5px] leading-snug text-[var(--text-2)]"
                        >
                          {event.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
