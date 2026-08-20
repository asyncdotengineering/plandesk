import type { SerializedGoal } from './api.js';

export type GoalChoice = {
  activeGoals: SerializedGoal[];
  defaultGoalId: string | null;
  requiresChoice: boolean;
};

export function resolveGoalChoice(
  goals: SerializedGoal[] | undefined,
  currentGoalId: string | null,
): GoalChoice {
  // Array.isArray, not ?? — a test-double API returning a non-array must degrade
  // to "no goals", never crash the board render.
  const activeGoals = Array.isArray(goals) ? goals.filter((goal) => goal.status === 'active') : [];
  const current = activeGoals.find((goal) => goal.id === currentGoalId);
  const defaultGoalId =
    current?.id ?? (activeGoals.length === 1 ? (activeGoals[0]?.id ?? null) : null);
  return {
    activeGoals,
    defaultGoalId,
    requiresChoice: activeGoals.length > 1 && current === undefined,
  };
}

const GOAL_LABEL_MAX = 60;

export function goalOptionLabel(goal: SerializedGoal): string {
  const label = goal.name ?? goal.objective;
  return label.length > GOAL_LABEL_MAX ? `${label.slice(0, GOAL_LABEL_MAX - 1)}…` : label;
}
