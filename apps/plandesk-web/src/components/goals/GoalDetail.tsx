import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, type SerializedGoalDetail } from '../../lib/api.js';
import { useCompleteGoal, usePauseGoal, useResumeGoal } from '../../lib/queries.js';
import { StatusChip } from '@/components/board/StatusChip';
import { ConfirmDialog } from '@/components/docs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AcceptanceGateChip, GoalStatusBadge } from './goal-ui.js';

type GoalDetailProps = {
  projectId: string;
  goal: SerializedGoalDetail;
};

function parseVerificationSurfaceKind(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { kind?: string };
    return typeof parsed.kind === 'string' ? parsed.kind : null;
  } catch {
    return null;
  }
}

function formatVerificationSurface(raw: string | null): string {
  if (raw === null) {
    return 'None';
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.kind !== 'string') {
      return raw;
    }
    switch (parsed.kind) {
      case 'gate_command':
        return `Gate command: ${typeof parsed.command === 'string' ? parsed.command : '(missing command)'}`;
      case 'acceptance_checklist': {
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        const lines = items
          .map((item) => {
            if (typeof item === 'object' && item !== null && 'criterion' in item) {
              return `• ${String((item as { criterion: unknown }).criterion)}`;
            }
            return null;
          })
          .filter((line): line is string => line !== null);
        return lines.length > 0
          ? `Acceptance checklist:\n${lines.join('\n')}`
          : 'Acceptance checklist (empty)';
      }
      case 'human_sign_off':
        return 'Human sign-off required';
      default:
        return raw;
    }
  } catch {
    return raw;
  }
}

function formatGoalError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : 'Request failed';
  }
  try {
    const body = JSON.parse(error.body) as {
      error?: string;
      incomplete_task_ids?: string[];
      required_kind?: string;
    };
    if (body.error === 'blocked_by_incomplete_tasks') {
      const count = body.incomplete_task_ids?.length ?? 0;
      return `Cannot complete: ${String(count)} cycle task(s) still incomplete. Edit them on the Board.`;
    }
    if (body.error === 'verification_required') {
      return `Verification required (${body.required_kind ?? 'unknown'}). Completion is handled by the runner, not this UI.`;
    }
    return error.message;
  } catch {
    return error.message;
  }
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    // A 140px label column against a 390px screen leaves nothing for the value.
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm md:grid-cols-[minmax(0,140px)_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-foreground">{value}</dd>
    </div>
  );
}

export function GoalDetail({ projectId, goal }: GoalDetailProps) {
  const pauseGoal = usePauseGoal(projectId);
  const resumeGoal = useResumeGoal(projectId);
  const completeGoal = useCompleteGoal(projectId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [markCompleteOpen, setMarkCompleteOpen] = useState(false);
  const [approverName, setApproverName] = useState('human');

  const surfaceKind = parseVerificationSurfaceKind(goal.verification_surface);
  const showSignOffComplete = surfaceKind === 'human_sign_off' && goal.status !== 'complete';
  const showMarkComplete =
    goal.verification_surface === null && goal.status !== 'complete' && goal.status !== 'blocked';

  const handleMarkComplete = () => {
    setActionError(null);
    completeGoal.mutate(
      { goalId: goal.id },
      {
        onSuccess: () => {
          setMarkCompleteOpen(false);
          toast('Goal completed');
        },
        onError: (error) => {
          setActionError(formatGoalError(error));
        },
      },
    );
  };

  const handleSignOffComplete = () => {
    const approvedBy = approverName.trim();
    if (approvedBy === '') {
      return;
    }
    setActionError(null);
    completeGoal.mutate(
      { goalId: goal.id, evidence: { kind: 'human_sign_off', approved_by: approvedBy } },
      {
        onSuccess: () => {
          setSignOffOpen(false);
          toast('Goal completed');
        },
        onError: (error) => {
          setActionError(formatGoalError(error));
        },
      },
    );
  };

  const lifecyclePending = pauseGoal.isPending || resumeGoal.isPending || completeGoal.isPending;
  const verificationText = formatVerificationSurface(goal.verification_surface);
  const isMultilineVerification = verificationText.includes('\n');

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold leading-snug tracking-tight">
          {goal.name ?? goal.objective}
        </h2>
        {goal.name !== null ? (
          <p className="text-sm text-muted-foreground">{goal.objective}</p>
        ) : null}
        <GoalStatusBadge status={goal.status} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Verification surface</CardTitle>
        </CardHeader>
        <CardContent>
          {isMultilineVerification ? (
            <pre className="m-0 whitespace-pre-wrap font-sans text-sm text-foreground">
              {verificationText}
            </pre>
          ) : (
            <p className="m-0 text-sm text-foreground">{verificationText}</p>
          )}
        </CardContent>
      </Card>

      {(goal.stop_condition !== null ||
        goal.constraints !== null ||
        goal.boundaries !== null ||
        goal.iteration_policy !== null ||
        goal.budget !== null) && (
        <dl className="space-y-3 rounded-[10px] border border-border bg-card p-4 shadow-[var(--shadow)]">
          {goal.stop_condition !== null ? (
            <DetailField label="Stop condition" value={goal.stop_condition} />
          ) : null}
          {goal.constraints !== null ? (
            <DetailField label="Constraints" value={goal.constraints} />
          ) : null}
          {goal.boundaries !== null ? (
            <DetailField label="Boundaries" value={goal.boundaries} />
          ) : null}
          {goal.iteration_policy !== null ? (
            <DetailField label="Iteration policy" value={goal.iteration_policy} />
          ) : null}
          {goal.budget !== null ? <DetailField label="Budget" value={goal.budget} /> : null}
        </dl>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Acceptance status</h3>
        <AcceptanceGateChip verification={goal.last_verification} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Cycle tasks</h3>
        {goal.cycle_tasks.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No cycle tasks.</p>
        ) : (
          <ul className="m-0 divide-y divide-border list-none overflow-hidden rounded-[10px] border border-border bg-card p-0 shadow-[var(--shadow)]">
            {goal.cycle_tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm">{task.label}</span>
                <StatusChip
                  status={task.status}
                  disabled
                  tabIndex={-1}
                  className="pointer-events-none shrink-0"
                />
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/projects/$id/board"
          params={{ id: projectId }}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Edit tasks on Board →
        </Link>
      </section>

      <Separator />

      <div className="flex flex-wrap gap-2">
        {goal.status === 'active' ? (
          <Button
            type="button"
            variant="outline"
            disabled={lifecyclePending}
            onClick={() => {
              setActionError(null);
              pauseGoal.mutate(goal.id, {
                onSuccess: () => {
                  toast('Goal paused');
                },
                onError: (error) => {
                  setActionError(formatGoalError(error));
                },
              });
            }}
          >
            Pause
          </Button>
        ) : null}
        {goal.status === 'paused' ? (
          <Button
            type="button"
            variant="outline"
            disabled={lifecyclePending}
            onClick={() => {
              setActionError(null);
              resumeGoal.mutate(goal.id, {
                onSuccess: () => {
                  toast('Goal resumed');
                },
                onError: (error) => {
                  setActionError(formatGoalError(error));
                },
              });
            }}
          >
            Resume
          </Button>
        ) : null}
        {showSignOffComplete ? (
          <Button
            type="button"
            disabled={lifecyclePending}
            onClick={() => {
              setApproverName('human');
              setSignOffOpen(true);
            }}
          >
            Sign off & complete
          </Button>
        ) : null}
        {showMarkComplete ? (
          <Button
            type="button"
            disabled={lifecyclePending}
            onClick={() => {
              setMarkCompleteOpen(true);
            }}
          >
            Mark complete
          </Button>
        ) : null}
        {surfaceKind === 'gate_command' || surfaceKind === 'acceptance_checklist' ? (
          <p className="text-sm text-muted-foreground">
            Completion is handled automatically by the agent runner when this goal&apos;s gate
            passes — there&apos;s nothing to click here.
          </p>
        ) : null}
      </div>

      {actionError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <Dialog
        open={signOffOpen}
        onOpenChange={(open) => {
          if (open) {
            setApproverName('human');
          }
          setSignOffOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign off & complete</DialogTitle>
            <DialogDescription>
              Enter the approver name to record human sign-off evidence. This action is
              irreversible.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleSignOffComplete();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="approver-name" className="text-xs text-muted-foreground">
                Approver name
              </Label>
              <Input
                id="approver-name"
                autoFocus
                value={approverName}
                onChange={(event) => {
                  setApproverName(event.target.value);
                }}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSignOffOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={lifecyclePending || approverName.trim() === ''}>
                Sign off & complete
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={markCompleteOpen}
        onOpenChange={setMarkCompleteOpen}
        title="Mark this goal complete?"
        description="This action is irreversible. The goal will be marked complete without additional verification."
        confirmLabel="Mark complete"
        cancelLabel="Cancel"
        busy={lifecyclePending}
        onConfirm={handleMarkComplete}
      />
    </div>
  );
}
