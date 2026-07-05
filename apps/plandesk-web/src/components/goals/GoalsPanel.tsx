import { useState } from 'react';
import type { GoalStatus, SerializedGoal, SerializedLastVerification } from '../../lib/api.js';
import { useCreateGoal, useGoal, useGoals } from '../../lib/queries.js';
import { GoalDetail } from './GoalDetail.js';

type GoalsPanelProps = {
  projectId: string;
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

export function GoalsPanel({ projectId }: GoalsPanelProps) {
  const { data: goals, isLoading, error } = useGoals(projectId);
  const createGoal = useCreateGoal(projectId);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
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
          setSelectedGoalId(goal.id);
        },
        onError: (err) => {
          setFormError(err instanceof Error ? err.message : 'Failed to create goal');
        },
      },
    );
  };

  if (isLoading) {
    return <p>Loading goals…</p>;
  }

  if (error !== null) {
    return <p role="alert">Failed to load goals: {error.message}</p>;
  }

  const goalList = goals ?? [];

  return (
    <div>
      <section
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>New goal</h2>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
            Objective
          </span>
          <input
            type="text"
            value={newObjective}
            onChange={(event) => {
              setNewObjective(event.target.value);
            }}
            style={{ width: '100%', padding: '0.375rem 0.5rem', boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          <span style={{ display: 'block', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
            verification_surface (optional JSON)
          </span>
          <textarea
            value={newSurface}
            onChange={(event) => {
              setNewSurface(event.target.value);
            }}
            rows={3}
            placeholder='{"kind":"human_sign_off"} or {"kind":"gate_command","command":"pnpm test"}'
            style={{
              width: '100%',
              padding: '0.375rem 0.5rem',
              boxSizing: 'border-box',
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
            }}
          />
        </label>
        {formError !== null ? (
          <p role="alert" style={{ color: '#b91c1c', fontSize: '0.8125rem' }}>
            {formError}
          </p>
        ) : null}
        <button
          type="button"
          disabled={createGoal.isPending}
          onClick={handleCreate}
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
          Create goal
        </button>
      </section>

      {goalList.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No goals yet. Create one above.</p>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              minWidth: '16rem',
              flexShrink: 0,
            }}
          >
            {goalList.map((goal: SerializedGoal) => (
              <li key={goal.id} style={{ marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGoalId(goal.id);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 6,
                    border:
                      effectiveSelectedId === goal.id ? '2px solid #1a56db' : '1px solid #e5e7eb',
                    background: effectiveSelectedId === goal.id ? '#eff6ff' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{goal.objective}</div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={statusChipStyle(goal.status)}>{goal.status}</span>
                    <AcceptanceIndicator verification={goal.last_verification} />
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div style={{ flex: 1, minWidth: 0 }}>
            {effectiveSelectedId === null ? (
              <p>Select a goal.</p>
            ) : detailLoading ? (
              <p>Loading goal…</p>
            ) : selectedGoal !== undefined ? (
              <GoalDetail projectId={projectId} goal={selectedGoal} />
            ) : (
              <p>Goal not found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
