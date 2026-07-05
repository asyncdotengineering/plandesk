import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ApiError,
  type GoalStatus,
  type SerializedGoalDetail,
  type SerializedLastVerification,
} from '../../lib/api.js';
import { useCompleteGoal, usePauseGoal, useResumeGoal } from '../../lib/queries.js';

type GoalDetailProps = {
  projectId: string;
  goal: SerializedGoalDetail;
};

const statusColors: Record<GoalStatus, { background: string; color: string }> = {
  active: { background: '#dbeafe', color: '#1e40af' },
  paused: { background: '#fef3c7', color: '#b45309' },
  complete: { background: '#dcfce7', color: '#15803d' },
  blocked: { background: '#fee2e2', color: '#b91c1c' },
};

function statusChipStyle(status: GoalStatus) {
  return {
    fontSize: '0.6875rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    padding: '0.125rem 0.375rem',
    borderRadius: 4,
    ...statusColors[status],
  };
}

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

function AcceptanceIndicator({
  verification,
}: {
  verification: SerializedLastVerification | null;
}) {
  if (verification === null) {
    return <span aria-label="acceptance unknown">○</span>;
  }
  if (verification.green) {
    return <span aria-label="acceptance passed">✓</span>;
  }
  return <span aria-label="acceptance failed">✗</span>;
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

export function GoalDetail({ projectId, goal }: GoalDetailProps) {
  const pauseGoal = usePauseGoal(projectId);
  const resumeGoal = useResumeGoal(projectId);
  const completeGoal = useCompleteGoal(projectId);
  const [actionError, setActionError] = useState<string | null>(null);

  const surfaceKind = parseVerificationSurfaceKind(goal.verification_surface);
  const showSignOffComplete = surfaceKind === 'human_sign_off' && goal.status !== 'complete';
  const showMarkComplete =
    goal.verification_surface === null && goal.status !== 'complete' && goal.status !== 'blocked';

  const handleComplete = () => {
    setActionError(null);
    if (surfaceKind === 'human_sign_off') {
      const approvedBy = prompt('Approver name', 'human')?.trim() ?? '';
      if (approvedBy === '') {
        return;
      }
      completeGoal.mutate(
        { goalId: goal.id, evidence: { kind: 'human_sign_off', approved_by: approvedBy } },
        {
          onError: (error) => {
            setActionError(formatGoalError(error));
          },
        },
      );
      return;
    }
    completeGoal.mutate(
      { goalId: goal.id },
      {
        onError: (error) => {
          setActionError(formatGoalError(error));
        },
      },
    );
  };

  const lifecyclePending = pauseGoal.isPending || resumeGoal.isPending || completeGoal.isPending;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{goal.objective}</h2>
      <p>
        <span style={statusChipStyle(goal.status)}>{goal.status}</span>
      </p>

      <section style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Verification surface</h3>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: '0.875rem',
          }}
        >
          {formatVerificationSurface(goal.verification_surface)}
        </pre>
      </section>

      {goal.stop_condition !== null ? (
        <section style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Stop condition</h3>
          <p style={{ margin: 0 }}>{goal.stop_condition}</p>
        </section>
      ) : null}

      {goal.constraints !== null ? (
        <section style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Constraints</h3>
          <p style={{ margin: 0 }}>{goal.constraints}</p>
        </section>
      ) : null}

      {goal.boundaries !== null ? (
        <section style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Boundaries</h3>
          <p style={{ margin: 0 }}>{goal.boundaries}</p>
        </section>
      ) : null}

      {goal.iteration_policy !== null ? (
        <section style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Iteration policy</h3>
          <p style={{ margin: 0 }}>{goal.iteration_policy}</p>
        </section>
      ) : null}

      {goal.budget !== null ? (
        <section style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Budget</h3>
          <p style={{ margin: 0 }}>{goal.budget}</p>
        </section>
      ) : null}

      <section style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Acceptance status</h3>
        <p style={{ margin: 0 }}>
          <AcceptanceIndicator verification={goal.last_verification} />
          {goal.last_verification !== null ? (
            <>
              {' '}
              {goal.last_verification.green ? 'Passed' : 'Failed'}
              {goal.last_verification.detail !== undefined
                ? ` — ${goal.last_verification.detail}`
                : ''}{' '}
              <span style={{ color: '#6b7280', fontSize: '0.8125rem' }}>
                ({new Date(goal.last_verification.at).toLocaleString()})
              </span>
            </>
          ) : (
            ' No verification recorded yet'
          )}
        </p>
      </section>

      <section style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Cycle tasks</h3>
        {goal.cycle_tasks.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280' }}>No cycle tasks.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {goal.cycle_tasks.map((task) => (
              <li key={task.id} style={{ marginBottom: '0.375rem' }}>
                {task.label}{' '}
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: '#6b7280',
                  }}
                >
                  {task.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
          <Link to="/projects/$id/board" params={{ id: projectId }} style={{ color: '#1a56db' }}>
            Edit tasks on Board →
          </Link>
        </p>
      </section>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {goal.status === 'active' ? (
          <button
            type="button"
            disabled={lifecyclePending}
            onClick={() => {
              setActionError(null);
              pauseGoal.mutate(goal.id, {
                onError: (error) => {
                  setActionError(formatGoalError(error));
                },
              });
            }}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Pause
          </button>
        ) : null}
        {goal.status === 'paused' ? (
          <button
            type="button"
            disabled={lifecyclePending}
            onClick={() => {
              setActionError(null);
              resumeGoal.mutate(goal.id, {
                onError: (error) => {
                  setActionError(formatGoalError(error));
                },
              });
            }}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Resume
          </button>
        ) : null}
        {showSignOffComplete ? (
          <button
            type="button"
            disabled={lifecyclePending}
            onClick={handleComplete}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: 'none',
              background: '#1e40af',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign off & complete
          </button>
        ) : null}
        {showMarkComplete ? (
          <button
            type="button"
            disabled={lifecyclePending}
            onClick={handleComplete}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: 'none',
              background: '#15803d',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Mark complete
          </button>
        ) : null}
      </div>

      {actionError !== null ? (
        <p role="alert" style={{ color: '#b91c1c', marginTop: '0.75rem' }}>
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
