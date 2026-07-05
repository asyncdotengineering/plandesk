import {
  createGoal,
  getGoal,
  getProject,
  InvalidGoalStatusError,
  isGoalStatus,
  listGoals,
  listTagsByTaskForProject,
  listTasks,
  updateGoal,
  updateGoalStatus,
  type Db,
  type GoalStatus,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import { serializeGoal, serializeTask } from '../serialize.js';

export type GoalServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export class InvalidGoalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGoalTransitionError';
  }
}

export class GoalCompletionBlockedError extends Error {
  incompleteTaskIds: string[];

  constructor(incompleteTaskIds: string[]) {
    super('Goal cannot be completed until all cycle-tasks are done');
    this.name = 'GoalCompletionBlockedError';
    this.incompleteTaskIds = incompleteTaskIds;
  }
}

export type CreateGoalInput = {
  objective: string;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
  status?: GoalStatus;
};

export type UpdateGoalInput = {
  objective?: string;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
};

function cycleTasksForGoal(db: Db, projectId: string, goalId: string) {
  const tagsByTask = listTagsByTaskForProject(db, projectId);
  return listTasks(db, projectId)
    .filter((task) => task.goalId === goalId)
    .map((task) => serializeTask(task, tagsByTask.get(task.id) ?? []));
}

function emitGoalUpdated(eventBus: EventBus, goalId: string, projectId: string) {
  eventBus.emit({ type: 'goal_updated', goalId, projectId });
}

export function createGoalService(deps: GoalServiceDeps) {
  const { db, eventBus } = deps;

  return {
    create(projectId: string, input: CreateGoalInput) {
      if (input.status !== undefined && !isGoalStatus(input.status)) {
        throw new InvalidGoalStatusError(input.status);
      }

      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const goal = db.transaction((tx) =>
        createGoal(tx, {
          projectId,
          objective: input.objective,
          status: input.status,
          verificationSurface: input.verificationSurface,
          constraints: input.constraints,
          boundaries: input.boundaries,
          iterationPolicy: input.iterationPolicy,
          stopCondition: input.stopCondition,
          budget: input.budget,
        }),
      );

      emitGoalUpdated(eventBus, goal.id, projectId);
      return serializeGoal(goal);
    },

    get(goalId: string) {
      const goal = getGoal(db, goalId);
      if (!goal) {
        return undefined;
      }
      return {
        ...serializeGoal(goal),
        cycle_tasks: cycleTasksForGoal(db, goal.projectId, goalId),
      };
    },

    listByProject(projectId: string) {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return listGoals(db, projectId).map(serializeGoal);
    },

    update(goalId: string, input: UpdateGoalInput) {
      const existing = getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }

      const goal = db.transaction((tx) => updateGoal(tx, goalId, input));
      if (!goal) {
        return undefined;
      }

      emitGoalUpdated(eventBus, goalId, existing.projectId);
      return serializeGoal(goal);
    },

    pause(goalId: string) {
      const existing = getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      if (existing.status !== 'active') {
        throw new InvalidGoalTransitionError('Goal can only be paused from active status');
      }

      const goal = db.transaction((tx) => updateGoalStatus(tx, goalId, 'paused'));
      if (!goal) {
        return undefined;
      }

      emitGoalUpdated(eventBus, goalId, existing.projectId);
      return serializeGoal(goal);
    },

    resume(goalId: string) {
      const existing = getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      if (existing.status !== 'paused') {
        throw new InvalidGoalTransitionError('Goal can only be resumed from paused status');
      }

      const goal = db.transaction((tx) => updateGoalStatus(tx, goalId, 'active'));
      if (!goal) {
        return undefined;
      }

      emitGoalUpdated(eventBus, goalId, existing.projectId);
      return serializeGoal(goal);
    },

    complete(goalId: string) {
      const existing = getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      if (existing.status === 'complete') {
        throw new InvalidGoalTransitionError('Goal is already complete');
      }

      const incomplete = listTasks(db, existing.projectId)
        .filter((task) => task.goalId === goalId && task.status !== 'done')
        .map((task) => task.id);
      if (incomplete.length > 0) {
        throw new GoalCompletionBlockedError(incomplete);
      }
      // S3 will additionally gate completion on verification_surface evidence.

      const goal = db.transaction((tx) => updateGoalStatus(tx, goalId, 'complete'));
      if (!goal) {
        return undefined;
      }

      emitGoalUpdated(eventBus, goalId, existing.projectId);
      return serializeGoal(goal);
    },
  };
}

export type GoalService = ReturnType<typeof createGoalService>;
