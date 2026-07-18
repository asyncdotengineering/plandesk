import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { SerializedSubmission } from '../../lib/api.js';
import {
  useComments,
  usePatchTask,
  useSubmissions,
  useTasks,
  useTriageSubmission,
} from '../../lib/queries.js';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CommentsPanel } from '../docs/CommentsPanel.js';
import { ConfirmDialog } from '../docs/ConfirmDialog.js';

type InboxPanelProps = {
  projectId: string;
};

const EXCERPT_LENGTH = 140;

function excerpt(text: string | null): string | null {
  if (text === null || text.trim() === '') {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_LENGTH ? `${trimmed.slice(0, EXCERPT_LENGTH)}…` : trimmed;
}

// The Curator's triage skill (.agents/curator/triage.md) tags every proposal it
// writes with a one-line `Provenance:` marker in the task description — that
// literal string is the only signal we have client-side to recognize a
// Curator-authored `scope` task versus any other one.
function provenanceLine(description: string | null): string | null {
  if (description === null) {
    return null;
  }
  const line = description.split('\n').find((candidate) => candidate.includes('Provenance:'));
  return line?.trim() ?? null;
}

const severityTokenVars = {
  medium: { bg: 'var(--s-prog-bg)', fg: 'var(--s-prog-fg)' },
  low: { bg: 'var(--s-done-bg)', fg: 'var(--s-done-fg)' },
} as const;

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'high') {
    return (
      <span
        className={cn(
          badgeVariants({ variant: 'destructive' }),
          'text-[10.5px] font-semibold uppercase tracking-wide',
        )}
      >
        {severity}
      </span>
    );
  }

  const vars =
    severity in severityTokenVars
      ? severityTokenVars[severity as keyof typeof severityTokenVars]
      : { bg: 'var(--muted)', fg: 'var(--muted-foreground)' };

  return (
    <span
      className={cn(
        badgeVariants({ variant: 'secondary' }),
        'border-transparent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
      )}
      style={{ backgroundColor: vars.bg, color: vars.fg }}
    >
      {severity}
    </span>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {count !== undefined && count > 0 ? (
        <Badge
          variant="secondary"
          className="h-[18px] rounded-full px-2 text-[11px] font-normal text-muted-foreground"
        >
          {count}
        </Badge>
      ) : null}
    </div>
  );
}

function SubmissionRow({
  submission,
  projectId,
  tasks,
}: {
  submission: SerializedSubmission;
  projectId: string;
  tasks: { id: string; label: string }[];
}) {
  const triage = useTriageSubmission(projectId);
  const [mergeTaskId, setMergeTaskId] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const commentTarget = { type: 'submission' as const, id: submission.id };
  const { data: comments } = useComments(commentTarget);
  const openCommentCount = (comments ?? []).filter((comment) => !comment.resolved).length;

  return (
    <Card className="gap-0 rounded-[10px] py-0 shadow-sm">
      <CardContent className="flex flex-col gap-2 px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold">{submission.title}</p>
          <span className="flex shrink-0 items-center gap-2">
            {submission.severity !== null ? (
              <SeverityBadge severity={submission.severity} />
            ) : null}
            <span className="text-xs text-muted-foreground">{submission.participant_name}</span>
          </span>
        </div>

        {excerpt(submission.body) !== null ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{excerpt(submission.body)}</p>
        ) : null}

        {triage.isError ? (
          <p role="alert" className="text-xs text-destructive">
            Something went wrong. Please try again.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={triage.isPending}
            onClick={() => {
              triage.mutate(
                { id: submission.id, input: { action: 'accept' } },
                { onSuccess: () => toast.success('Submission approved') },
              );
            }}
          >
            {triage.isPending ? 'Approving…' : 'Approve'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={triage.isPending}
            onClick={() => {
              setRejectOpen(true);
            }}
          >
            Reject
          </Button>
          <Select
            value={mergeTaskId}
            onValueChange={setMergeTaskId}
            disabled={triage.isPending}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Select a task" />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {task.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={triage.isPending || mergeTaskId === ''}
            onClick={() => {
              triage.mutate(
                {
                  id: submission.id,
                  input: { action: 'accept', link_task_id: mergeTaskId },
                },
                { onSuccess: () => toast.success('Merged into existing task') },
              );
            }}
          >
            Merge into
          </Button>
        </div>

        <div>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            onClick={() => {
              setCommentsOpen((open) => !open);
            }}
            aria-expanded={commentsOpen}
          >
            {commentsOpen
              ? 'Hide comments'
              : openCommentCount > 0
                ? `Comments (${String(openCommentCount)} open)`
                : 'Comments'}
          </Button>
          {commentsOpen ? <CommentsPanel target={commentTarget} embedded /> : null}
        </div>
      </CardContent>
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject submission?"
        description="Reject this submission? The client isn't notified and this can't be undone."
        confirmLabel="Reject"
        busy={triage.isPending}
        onConfirm={() => {
          triage.mutate(
            { id: submission.id, input: { action: 'reject' } },
            {
              onSuccess: () => {
                setRejectOpen(false);
                toast.success('Submission rejected');
              },
            },
          );
        }}
      />
    </Card>
  );
}

function PendingSubmissions({ projectId, tasks }: { projectId: string; tasks: { id: string; label: string }[] }) {
  const { data: submissions, isLoading, error } = useSubmissions(projectId, 'pending');

  return (
    <section aria-label="Pending submissions" className="mb-5">
      <SectionHeader title="Pending submissions" count={submissions?.length} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Failed to load submissions.
        </p>
      ) : null}
      {!isLoading && !error && (submissions === undefined || submissions.length === 0) ? (
        <p className="text-sm text-muted-foreground">
          No pending submissions — this project has no share configured, or nothing new has come in.
        </p>
      ) : null}
      {submissions !== undefined && submissions.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <SubmissionRow submission={submission} projectId={projectId} tasks={tasks} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function BacklogTasks({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading, error } = useTasks(projectId, { status: 'backlog' });
  const patchTask = usePatchTask();

  return (
    <section aria-label="Un-triaged backlog" className="mb-5">
      <SectionHeader title="Un-triaged backlog" count={tasks?.length} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Failed to load backlog tasks.
        </p>
      ) : null}
      {!isLoading && !error && (tasks === undefined || tasks.length === 0) ? (
        <p className="text-sm text-muted-foreground">Nothing in the backlog right now.</p>
      ) : null}
      {tasks !== undefined && tasks.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {tasks.map((task) => (
            <li key={task.id}>
              <Card className="gap-0 rounded-[10px] py-0 shadow-sm">
                <CardContent className="flex items-start justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{task.label}</p>
                    {excerpt(task.description) !== null ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {excerpt(task.description)}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={patchTask.isPending}
                    title="Moves this backlog item into the Scope column for design and sizing."
                    onClick={() => {
                      patchTask.mutate(
                        { id: task.id, input: { status: 'scope' } },
                        { onSuccess: () => toast.success('Sent to planning') },
                      );
                    }}
                  >
                    Send to planning
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CuratorProposals({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading, error } = useTasks(projectId, { status: 'scope' });

  const proposals = (tasks ?? []).filter((task) => provenanceLine(task.description) !== null);

  return (
    <section aria-label="Curator proposals awaiting approval" className="mb-5">
      <SectionHeader title="Curator proposals awaiting approval" count={proposals.length} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Failed to load proposals.
        </p>
      ) : null}
      {!isLoading && !error && proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Curator proposals waiting right now.</p>
      ) : null}
      {proposals.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            These are `scope` tasks the Curator proposed. Releasing a task from <code>scope</code>{' '}
            to <code>todo</code> on the{' '}
            <Link
              to="/projects/$id/board"
              params={{ id: projectId }}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Board
            </Link>{' '}
            is the actual approval — nothing here does that for you.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {proposals.map((task) => (
              <li key={task.id}>
                <Card className="gap-0 rounded-[10px] py-0 shadow-sm">
                  <CardContent className="flex items-start justify-between gap-3 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{task.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {provenanceLine(task.description)}
                      </p>
                    </div>
                    <Link
                      to="/projects/$id/board"
                      params={{ id: projectId }}
                      className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Open Board
                    </Link>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function InboxPanel({ projectId }: InboxPanelProps) {
  const { data: allTasks } = useTasks(projectId);
  const taskOptions = (allTasks ?? []).map((t) => ({ id: t.id, label: t.label }));

  return (
    <div>
      <PendingSubmissions projectId={projectId} tasks={taskOptions} />
      <BacklogTasks projectId={projectId} />
      <CuratorProposals projectId={projectId} />
    </div>
  );
}