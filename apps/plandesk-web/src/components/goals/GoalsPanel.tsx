import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { SerializedGoal } from '../../lib/api.js';
import { useCreateGoal, useGoal, useGoals } from '../../lib/queries.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { GoalDetail } from './GoalDetail.js';
import { AcceptanceIndicator, GoalStatusBadge } from './goal-ui.js';

type GoalsPanelProps = {
  projectId: string;
};

export function GoalsPanel({ projectId }: GoalsPanelProps) {
  const { data: goals, isLoading, error } = useGoals(projectId);
  const createGoal = useCreateGoal(projectId);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newObjective, setNewObjective] = useState('');
  const [newSurface, setNewSurface] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const effectiveSelectedId = selectedGoalId ?? goals?.[0]?.id ?? null;
  const { data: selectedGoal, isLoading: detailLoading } = useGoal(effectiveSelectedId ?? '');

  const handleCreate = () => {
    const objective = newObjective.trim();
    if (objective === '') {
      setFormError('Objective is required');
      return;
    }
    setFormError(null);
    let verification_surface: string | null = null;
    const surfaceRaw = newSurface.trim();
    if (surfaceRaw !== '') {
      try {
        JSON.parse(surfaceRaw);
        verification_surface = surfaceRaw;
      } catch {
        setFormError('verification_surface must be valid JSON');
        return;
      }
    }
    createGoal.mutate(
      { objective, ...(verification_surface !== null ? { verification_surface } : {}) },
      {
        onSuccess: (goal) => {
          setNewObjective('');
          setNewSurface('');
          setNewGoalOpen(false);
          setSelectedGoalId(goal.id);
          toast('Goal created');
        },
        onError: (err) => {
          setFormError(err instanceof Error ? err.message : 'Failed to create goal');
        },
      },
    );
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading goals…</p>;
  }

  if (error !== null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load goals: {error.message}
      </p>
    );
  }

  const goalList = goals ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">Goals</h2>
          <span className="text-xs text-muted-foreground">
            Durable contracts you hand to agents. Open one to watch it get built and act where a gate
            needs you.
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setFormError(null);
            setNewGoalOpen(true);
          }}
        >
          <PlusIcon className="size-3.5" />
          New goal
        </Button>
      </div>

      <Dialog
        open={newGoalOpen}
        onOpenChange={(open) => {
          if (open) {
            setFormError(null);
          }
          setNewGoalOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New goal</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-goal-objective" className="text-xs text-muted-foreground">
                Objective
              </Label>
              <Input
                id="new-goal-objective"
                autoFocus
                value={newObjective}
                onChange={(event) => {
                  setNewObjective(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-goal-surface" className="text-xs text-muted-foreground">
                verification_surface (optional JSON)
              </Label>
              <Textarea
                id="new-goal-surface"
                value={newSurface}
                rows={3}
                placeholder='{"kind":"human_sign_off"} or {"kind":"gate_command","command":"pnpm test"}'
                className="font-mono text-xs"
                onChange={(event) => {
                  setNewSurface(event.target.value);
                }}
              />
            </div>
            {formError !== null ? (
              <p role="alert" className="text-xs text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewGoalOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createGoal.isPending}>
                Create goal
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {goalList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No goals yet. Create one above.</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-6">
          <ul className="m-0 w-64 shrink-0 list-none space-y-2.5 p-0">
            {goalList.map((goal: SerializedGoal) => (
              <li key={goal.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGoalId(goal.id);
                  }}
                  className={cn(
                    'w-full cursor-pointer rounded-[10px] border bg-card p-3.5 text-left shadow-[var(--shadow)] transition-colors',
                    effectiveSelectedId === goal.id
                      ? 'border-[var(--border-strong)] bg-muted ring-1 ring-[var(--border-strong)]'
                      : 'border-border hover:bg-muted/50',
                  )}
                >
                  <p className="mb-2 text-sm font-semibold leading-snug">{goal.objective}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <GoalStatusBadge status={goal.status} />
                    <AcceptanceIndicator verification={goal.last_verification} />
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0 flex-1">
            {effectiveSelectedId === null ? (
              <p className="text-sm text-muted-foreground">Select a goal.</p>
            ) : detailLoading ? (
              <p className="text-sm text-muted-foreground">Loading goal…</p>
            ) : selectedGoal !== undefined ? (
              <GoalDetail projectId={projectId} goal={selectedGoal} />
            ) : (
              <p className="text-sm text-muted-foreground">Goal not found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}