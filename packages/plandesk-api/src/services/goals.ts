import {
  withTransaction,
  createGoal,
  createTask,
  getGoal,
  InvalidGoalStatusError,
  isGoalStatus,
  listGoals,
  listTagsByTaskForProject,
  listTasks,
  setProjectCurrentGoalId,
  updateGoal,
  updateGoalStatus,
  updateTask,
  type Db,
  type DbClient,
  type GoalStatus,
} from '@plandesk/db';
import { randomUUID } from 'node:crypto';
import { serializeGoal, serializeTask } from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type GoalServiceDeps = OrgScopedDeps & {
  db: Db;
};

export class InvalidGoalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGoalTransitionError';
  }
}

export class DuplicateGoalNameError extends Error {
  constructor(name: string) {
    super(`Goal name already exists in this project: ${name}`);
    this.name = 'DuplicateGoalNameError';
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

export class InvalidVerificationSurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVerificationSurfaceError';
  }
}

export class GoalVerificationRequiredError extends Error {
  requiredKind: VerificationSurfaceKind;

  constructor(requiredKind: VerificationSurfaceKind) {
    super(`Verification evidence required for surface kind: ${requiredKind}`);
    this.name = 'GoalVerificationRequiredError';
    this.requiredKind = requiredKind;
  }
}

export class InvalidChecklistEvidenceError extends Error {
  unmatched: string[];
  unmet: string[];

  constructor(unmatched: string[], unmet: string[]) {
    super('Checklist evidence did not match the declared acceptance criteria');
    this.name = 'InvalidChecklistEvidenceError';
    this.unmatched = unmatched;
    this.unmet = unmet;
  }
}

export type VerificationSurfaceKind = 'gate_command' | 'acceptance_checklist' | 'human_sign_off';

export type GateCommandSurface = { kind: 'gate_command'; command: string };
export type AcceptanceChecklistSurface = {
  kind: 'acceptance_checklist';
  items: Array<{ id: string; criterion: string }>;
};
export type HumanSignOffSurface = { kind: 'human_sign_off' };
export type VerificationSurface =
  | GateCommandSurface
  | AcceptanceChecklistSurface
  | HumanSignOffSurface;

export type GateCommandEvidence = {
  kind: 'gate_command';
  exit_code: number;
  command?: string;
  detail?: string;
};
export type AcceptanceChecklistEvidence = {
  kind: 'acceptance_checklist';
  checked: string[];
};
export type HumanSignOffEvidence = {
  kind: 'human_sign_off';
  approved_by: string;
};
export type VerificationEvidence =
  | GateCommandEvidence
  | AcceptanceChecklistEvidence
  | HumanSignOffEvidence;

export type LastVerificationRecord = {
  at: string;
  green: boolean;
  kind: VerificationSurfaceKind | null;
  detail?: string;
};

export type CreateGoalInput = {
  objective: string;
  name?: string | null;
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
  name?: string | null;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

type ParsedVerificationSurface =
  | GateCommandSurface
  | { kind: 'acceptance_checklist'; items: Array<{ id?: string; criterion: string }> }
  | HumanSignOffSurface;

function parseRawVerificationSurface(raw: string): ParsedVerificationSurface {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidVerificationSurfaceError('verification_surface must be valid JSON');
  }
  if (!isRecord(parsed) || typeof parsed.kind !== 'string') {
    throw new InvalidVerificationSurfaceError('verification_surface must include a kind');
  }

  switch (parsed.kind) {
    case 'gate_command': {
      if (!isNonEmptyString(parsed.command)) {
        throw new InvalidVerificationSurfaceError('gate_command requires a command');
      }
      return { kind: 'gate_command', command: parsed.command };
    }
    case 'acceptance_checklist': {
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new InvalidVerificationSurfaceError('acceptance_checklist requires non-empty items');
      }
      const items: Array<{ id?: string; criterion: string }> = [];
      for (const item of parsed.items) {
        if (!isRecord(item) || !isNonEmptyString(item.criterion)) {
          throw new InvalidVerificationSurfaceError(
            'acceptance_checklist items require a criterion',
          );
        }
        if (item.id !== undefined && !isNonEmptyString(item.id)) {
          throw new InvalidVerificationSurfaceError(
            'acceptance_checklist item ids must be non-empty strings',
          );
        }
        items.push({
          ...(item.id !== undefined ? { id: item.id } : {}),
          criterion: item.criterion,
        });
      }
      return { kind: 'acceptance_checklist', items };
    }
    case 'human_sign_off':
      return { kind: 'human_sign_off' };
    default:
      throw new InvalidVerificationSurfaceError(
        `Unknown verification_surface kind: ${parsed.kind}`,
      );
  }
}

export function parseVerificationSurface(raw: string | null): VerificationSurface | null {
  if (raw === null) {
    return null;
  }
  const parsed = parseRawVerificationSurface(raw);
  if (parsed.kind === 'acceptance_checklist') {
    return {
      kind: parsed.kind,
      items: parsed.items.map((item) => ({
        id: item.id ?? randomUUID(),
        criterion: item.criterion,
      })),
    };
  }
  return parsed;
}

function normalizeVerificationSurface(
  raw: string | null | undefined,
  existingRaw?: string | null,
): string | null | undefined {
  if (raw === undefined || raw === null) {
    return raw;
  }

  const incoming = parseRawVerificationSurface(raw);
  if (incoming.kind !== 'acceptance_checklist') {
    return JSON.stringify(incoming);
  }

  const existing = existingRaw ? parseVerificationSurface(existingRaw) : null;
  const existingItems = existing?.kind === 'acceptance_checklist' ? existing.items : [];
  const usedIds = new Set<string>();
  const items = incoming.items.map((item) => {
    const byId = item.id ? existingItems.find((candidate) => candidate.id === item.id) : undefined;
    const byCriterion = existingItems.find(
      (candidate) => !usedIds.has(candidate.id) && candidate.criterion === item.criterion,
    );
    const id = byId?.id ?? byCriterion?.id ?? randomUUID();
    usedIds.add(id);
    return { id, criterion: item.criterion };
  });
  return JSON.stringify({ kind: incoming.kind, items });
}

export function evaluateEvidence(
  surface: VerificationSurface,
  evidence: VerificationEvidence,
): { green: boolean; detail?: string; unmatched: string[]; unmet: string[] } {
  if (surface.kind !== evidence.kind) {
    return { green: false, detail: `Expected evidence kind ${surface.kind}`, unmatched: [], unmet: [] };
  }

  if (surface.kind === 'gate_command' && evidence.kind === 'gate_command') {
    if (evidence.exit_code === 0) {
      return { green: true, unmatched: [], unmet: [] };
    }
    const detail =
      evidence.detail ??
      `exit_code ${String(evidence.exit_code)}${evidence.command ? ` for \`${evidence.command}\`` : ''}`;
    return { green: false, detail, unmatched: [], unmet: [] };
  }

  if (surface.kind === 'acceptance_checklist' && evidence.kind === 'acceptance_checklist') {
    const matched = new Set<string>();
    const unmatched = evidence.checked.filter((entry) => {
      const item = surface.items.find(
        (candidate) => candidate.id === entry || candidate.criterion === entry,
      );
      if (!item) {
        return true;
      }
      matched.add(item.id);
      return false;
    });
    const unmet = surface.items
      .filter((item) => !matched.has(item.id))
      .map((item) => item.criterion);
    if (unmatched.length === 0 && unmet.length === 0) {
      return { green: true, unmatched, unmet };
    }
    const detail = [
      ...(unmatched.length > 0 ? [`Unmatched evidence: ${unmatched.join(', ')}`] : []),
      ...(unmet.length > 0 ? [`Missing criteria: ${unmet.join(', ')}`] : []),
    ].join('; ');
    return { green: false, detail, unmatched, unmet };
  }

  if (surface.kind === 'human_sign_off' && evidence.kind === 'human_sign_off') {
    if (isNonEmptyString(evidence.approved_by)) {
      return { green: true, unmatched: [], unmet: [] };
    }
    return { green: false, detail: 'approved_by is required', unmatched: [], unmet: [] };
  }

  return { green: false, detail: `Expected evidence kind ${surface.kind}`, unmatched: [], unmet: [] };
}

function acceptanceBlockMarker(goalId: string): string {
  return `Acceptance-block-for: ${goalId}`;
}

async function hasUnresolvedBlockingTask(
  db: DbClient,
  projectId: string,
  goalId: string,
): Promise<boolean> {
  const marker = acceptanceBlockMarker(goalId);
  return (await listTasks(db, projectId)).some(
    (task) =>
      task.goalId === goalId && task.status === 'scope' && task.description?.includes(marker),
  );
}

// When acceptance finally passes, the remediation task filed on the earlier red
// result is obsolete — resolve it so a completed goal never shows open work.
async function resolveBlockingTasks(
  db: DbClient,
  projectId: string,
  goalId: string,
): Promise<void> {
  const marker = acceptanceBlockMarker(goalId);
  for (const task of await listTasks(db, projectId)) {
    if (task.goalId === goalId && task.status !== 'done' && task.description?.includes(marker)) {
      await updateTask(db, task.id, { status: 'done' });
    }
  }
}

function truncateObjective(objective: string, maxLength = 80): string {
  if (objective.length <= maxLength) {
    return objective;
  }
  return `${objective.slice(0, maxLength - 1)}…`;
}

function buildBlockingTaskDescription(
  goalId: string,
  surfaceKind: VerificationSurfaceKind,
  detail?: string,
): string {
  const lines = [acceptanceBlockMarker(goalId), '', `Surface kind: ${surfaceKind}`];
  if (detail) {
    lines.push(`Detail: ${detail}`);
  }
  return lines.join('\n');
}

async function cycleTasksForGoal(db: Db, projectId: string, goalId: string) {
  const tagsByTask = await listTagsByTaskForProject(db, projectId);
  return (await listTasks(db, projectId))
    .filter((task) => task.goalId === goalId)
    .map((task) => serializeTask(task, tagsByTask.get(task.id) ?? []));
}

function recordLastVerification(
  at: string,
  green: boolean,
  kind: VerificationSurfaceKind | null,
  detail?: string,
): string {
  const record: LastVerificationRecord = { at, green, kind };
  if (detail) {
    record.detail = detail;
  }
  return JSON.stringify(record);
}

export function createGoalService(deps: GoalServiceDeps) {
  const { db } = deps;

  return {
    async create(projectId: string, input: CreateGoalInput) {
      assertPermission(deps, 'goal', 'create');
      if (input.status !== undefined && !isGoalStatus(input.status)) {
        throw new InvalidGoalStatusError(input.status);
      }
      const verificationSurface = normalizeVerificationSurface(input.verificationSurface);
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.name !== undefined && input.name !== null) {
        const duplicate = (await listGoals(db, projectId)).some(
          (goal) => goal.name === input.name,
        );
        if (duplicate) {
          throw new DuplicateGoalNameError(input.name);
        }
      }

      const goal = await withTransaction(db, async (tx) =>
        createGoal(tx, {
          projectId,
          objective: input.objective,
          name: input.name,
          status: input.status,
          verificationSurface,
          constraints: input.constraints,
          boundaries: input.boundaries,
          iterationPolicy: input.iterationPolicy,
          stopCondition: input.stopCondition,
          budget: input.budget,
        }),
      );


      return serializeGoal(goal);
    },

    /** Point the project's current_goal_id at an active goal for get_next_task resolution. */
    async setCurrent(goalId: string) {
      assertPermission(deps, 'goal', 'update');
      const existing = await getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (existing.status !== 'active') {
        throw new InvalidGoalTransitionError('Only an active goal can be set as current');
      }
      const project = await setProjectCurrentGoalId(db, existing.projectId, goalId);
      if (!project) {
        return undefined;
      }
      return {
        project_id: existing.projectId,
        current_goal_id: goalId,
        goal: serializeGoal(existing),
      };
    },

    async get(goalId: string) {
      const goal = await getGoal(db, goalId);
      if (!goal) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, goal.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return {
        ...serializeGoal(goal),
        cycle_tasks: await cycleTasksForGoal(db, goal.projectId, goalId),
      };
    },

    async listByProject(projectId: string) {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await listGoals(db, projectId)).map(serializeGoal);
    },

    async update(goalId: string, input: UpdateGoalInput) {
      assertPermission(deps, 'goal', 'update');
      const existing = await getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      const verificationSurface = normalizeVerificationSurface(
        input.verificationSurface,
        existing.verificationSurface,
      );
      if (input.name !== undefined && input.name !== null) {
        const duplicate = (await listGoals(db, existing.projectId)).some(
          (goal) => goal.id !== goalId && goal.name === input.name,
        );
        if (duplicate) {
          throw new DuplicateGoalNameError(input.name);
        }
      }

      const updateInput =
        input.verificationSurface === undefined
          ? input
          : { ...input, verificationSurface };
      const goal = await withTransaction(db, async (tx) => updateGoal(tx, goalId, updateInput));
      if (!goal) {
        return undefined;
      }

      return serializeGoal(goal);
    },

    async pause(goalId: string) {
      assertPermission(deps, 'goal', 'update');
      const existing = await getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (existing.status !== 'active') {
        throw new InvalidGoalTransitionError('Goal can only be paused from active status');
      }

      const goal = await withTransaction(db, async (tx) => updateGoalStatus(tx, goalId, 'paused'));
      if (!goal) {
        return undefined;
      }

      return serializeGoal(goal);
    },

    async resume(goalId: string) {
      assertPermission(deps, 'goal', 'update');
      const existing = await getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (existing.status !== 'paused') {
        throw new InvalidGoalTransitionError('Goal can only be resumed from paused status');
      }

      const goal = await withTransaction(db, async (tx) => updateGoalStatus(tx, goalId, 'active'));
      if (!goal) {
        return undefined;
      }

      return serializeGoal(goal);
    },

    async complete(goalId: string, evidence?: VerificationEvidence) {
      assertPermission(deps, 'goal', 'update');
      const existing = await getGoal(db, goalId);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (existing.status === 'complete') {
        throw new InvalidGoalTransitionError('Goal is already complete');
      }

      if (existing.status !== 'blocked') {
        const incomplete = (await listTasks(db, existing.projectId))
          .filter((task) => task.goalId === goalId && task.status !== 'done')
          .map((task) => task.id);
        if (incomplete.length > 0) {
          throw new GoalCompletionBlockedError(incomplete);
        }
      }

      const surface = parseVerificationSurface(existing.verificationSurface);
      const at = new Date().toISOString();

      if (!surface) {
        const goal = await withTransaction(db, async (tx) =>
          updateGoal(tx, goalId, {
            status: 'complete',
            lastVerification: recordLastVerification(at, true, null),
          }),
        );
        if (!goal) {
          return undefined;
        }
  
        return serializeGoal(goal);
      }

      if (!evidence || evidence.kind !== surface.kind) {
        throw new GoalVerificationRequiredError(surface.kind);
      }

      const evaluation = evaluateEvidence(surface, evidence);
      if (evaluation.unmatched.length > 0) {
        throw new InvalidChecklistEvidenceError(evaluation.unmatched, evaluation.unmet);
      }
      const lastVerification = recordLastVerification(
        at,
        evaluation.green,
        surface.kind,
        evaluation.detail,
      );

      if (evaluation.green) {
        const goal = await withTransaction(db, async (tx) => {
          const updated = await updateGoal(tx, goalId, {
            status: 'complete',
            lastVerification,
          });
          if (!updated) {
            return undefined;
          }
          await resolveBlockingTasks(tx, existing.projectId, goalId);
          return updated;
        });
        if (!goal) {
          return undefined;
        }
  
        return serializeGoal(goal);
      }

      const goal = await withTransaction(db, async (tx) => {
        const updated = await updateGoal(tx, goalId, {
          status: 'blocked',
          lastVerification,
        });
        if (!updated) {
          return undefined;
        }
        if (!(await hasUnresolvedBlockingTask(tx, existing.projectId, goalId))) {
          await createTask(tx, {
            projectId: existing.projectId,
            goalId,
            label: `Fix acceptance failure: ${truncateObjective(existing.objective)}`,
            status: 'scope',
            description: buildBlockingTaskDescription(goalId, surface.kind, evaluation.detail),
          });
        }
        return updated;
      });
      if (!goal) {
        return undefined;
      }


      return serializeGoal(goal);
    },
  };
}

export type GoalService = ReturnType<typeof createGoalService>;
