import { Hono, type Context } from 'hono';
import { InvalidGoalStatusError, isGoalStatus } from '@plandesk/db';
import {
  GoalCompletionBlockedError,
  GoalVerificationRequiredError,
  InvalidGoalTransitionError,
  InvalidVerificationSurfaceError,
  type GoalService,
  type VerificationEvidence,
} from '../services/goals.js';

type CreateGoalBody = {
  objective?: string;
  verification_surface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iteration_policy?: string | null;
  stop_condition?: string | null;
  budget?: string | null;
  status?: string;
};

type UpdateGoalBody = {
  objective?: string;
  verification_surface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iteration_policy?: string | null;
  stop_condition?: string | null;
  budget?: string | null;
};

type CompleteGoalBody = {
  evidence?: VerificationEvidence;
};

function mapGoalInput(body: CreateGoalBody | UpdateGoalBody) {
  return {
    ...(body.objective !== undefined ? { objective: body.objective } : {}),
    ...(body.verification_surface !== undefined
      ? { verificationSurface: body.verification_surface }
      : {}),
    ...(body.constraints !== undefined ? { constraints: body.constraints } : {}),
    ...(body.boundaries !== undefined ? { boundaries: body.boundaries } : {}),
    ...(body.iteration_policy !== undefined ? { iterationPolicy: body.iteration_policy } : {}),
    ...(body.stop_condition !== undefined ? { stopCondition: body.stop_condition } : {}),
    ...(body.budget !== undefined ? { budget: body.budget } : {}),
  };
}

function handleGoalError(c: Context, error: unknown) {
  if (error instanceof InvalidGoalStatusError || error instanceof InvalidGoalTransitionError) {
    return c.json({ error: 'invalid_argument' }, 400);
  }
  if (error instanceof InvalidVerificationSurfaceError) {
    return c.json({ error: 'invalid_argument' }, 400);
  }
  if (error instanceof GoalVerificationRequiredError) {
    return c.json(
      {
        error: 'verification_required',
        required_kind: error.requiredKind,
      },
      400,
    );
  }
  if (error instanceof GoalCompletionBlockedError) {
    return c.json(
      {
        error: 'blocked_by_incomplete_tasks',
        incomplete_task_ids: error.incompleteTaskIds,
      },
      400,
    );
  }
  throw error;
}

export function createGoalsRouter(goalService: GoalService): Hono {
  const router = new Hono();

  router.post('/projects/:id/goals', async (c) => {
    const body = await c.req.json<CreateGoalBody>();
    if (typeof body.objective !== 'string' || body.objective.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.status !== undefined && !isGoalStatus(body.status)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const goal = await goalService.create(c.req.param('id'), {
        objective: body.objective,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...mapGoalInput(body),
      });
      if (!goal) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(goal, 201);
    } catch (error) {
      return handleGoalError(c, error);
    }
  });

  router.get('/projects/:id/goals', async (c) => {
    const goals = await goalService.listByProject(c.req.param('id'));
    if (!goals) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(goals);
  });

  router.get('/goals/:id', async (c) => {
    const goal = await goalService.get(c.req.param('id'));
    if (!goal) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(goal);
  });

  router.patch('/goals/:id', async (c) => {
    const body = await c.req.json<UpdateGoalBody>();
    if (body.objective !== undefined && body.objective.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const goal = await goalService.update(c.req.param('id'), mapGoalInput(body));
      if (!goal) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(goal);
    } catch (error) {
      return handleGoalError(c, error);
    }
  });

  router.post('/goals/:id/pause', async (c) => {
    try {
      const goal = await goalService.pause(c.req.param('id'));
      if (!goal) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(goal);
    } catch (error) {
      return handleGoalError(c, error);
    }
  });

  router.post('/goals/:id/resume', async (c) => {
    try {
      const goal = await goalService.resume(c.req.param('id'));
      if (!goal) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(goal);
    } catch (error) {
      return handleGoalError(c, error);
    }
  });

  router.post('/goals/:id/complete', async (c) => {
    let body: CompleteGoalBody = {};
    try {
      body = await c.req.json<CompleteGoalBody>();
    } catch {
      // empty body is valid when the goal has no verification_surface
    }
    try {
      const goal = await goalService.complete(c.req.param('id'), body.evidence);
      if (!goal) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(goal);
    } catch (error) {
      return handleGoalError(c, error);
    }
  });

  return router;
}
