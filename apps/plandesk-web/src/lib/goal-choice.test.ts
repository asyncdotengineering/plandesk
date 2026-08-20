import { describe, expect, it } from 'vitest';
import type { SerializedGoal } from './api.js';
import { goalOptionLabel, resolveGoalChoice } from './goal-choice.js';

function makeGoal(
  id: string,
  status: SerializedGoal['status'],
  name: string | null = null,
  objective = `Objective for ${id}`,
): SerializedGoal {
  return {
    id,
    project_id: 'proj-1',
    name,
    objective,
    status,
    verification_surface: null,
    constraints: null,
    boundaries: null,
    iteration_policy: null,
    stop_condition: null,
    budget: null,
    last_verification: null,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
  };
}

describe('resolveGoalChoice', () => {
  it('keeps only active goals', () => {
    const choice = resolveGoalChoice(
      [makeGoal('g1', 'active'), makeGoal('g2', 'complete'), makeGoal('g3', 'paused')],
      null,
    );
    expect(choice.activeGoals.map((goal) => goal.id)).toEqual(['g1']);
  });

  it('defaults to the sole active goal without requiring a choice', () => {
    const choice = resolveGoalChoice([makeGoal('g1', 'active')], null);
    expect(choice.defaultGoalId).toBe('g1');
    expect(choice.requiresChoice).toBe(false);
  });

  it('defaults to the current goal when it is active among several', () => {
    const choice = resolveGoalChoice([makeGoal('g1', 'active'), makeGoal('g2', 'active')], 'g2');
    expect(choice.defaultGoalId).toBe('g2');
    expect(choice.requiresChoice).toBe(false);
  });

  it('requires a choice when several goals are active and none is current', () => {
    const choice = resolveGoalChoice([makeGoal('g1', 'active'), makeGoal('g2', 'active')], null);
    expect(choice.defaultGoalId).toBeNull();
    expect(choice.requiresChoice).toBe(true);
  });

  it('ignores a current goal that is not active', () => {
    const choice = resolveGoalChoice(
      [makeGoal('g1', 'active'), makeGoal('g2', 'active'), makeGoal('g3', 'complete')],
      'g3',
    );
    expect(choice.defaultGoalId).toBeNull();
    expect(choice.requiresChoice).toBe(true);
  });

  it('handles undefined goals and no active goals', () => {
    expect(resolveGoalChoice(undefined, null)).toEqual({
      activeGoals: [],
      defaultGoalId: null,
      requiresChoice: false,
    });
    expect(resolveGoalChoice([makeGoal('g1', 'complete')], null).requiresChoice).toBe(false);
  });
});

describe('goalOptionLabel', () => {
  it('prefers the goal name over the objective', () => {
    expect(goalOptionLabel(makeGoal('g1', 'active', 'runner-v1'))).toBe('runner-v1');
  });

  it('falls back to the objective and truncates long text', () => {
    const objective = 'x'.repeat(80);
    const label = goalOptionLabel(makeGoal('g1', 'active', null, objective));
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith('…')).toBe(true);
  });
});
