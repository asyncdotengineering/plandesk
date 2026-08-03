import { Hono } from 'hono';
import {
  InvalidTaskStatusError,
  InvalidTaskKindError,
  InvalidTaskPriorityError,
  InvalidTaskLaneError,
  InvalidTaskSeverityError,
  UnstoredColumnError,
  isTaskStatus,
  isTaskKind,
  isTaskPriority,
  isTaskLane,
  isTaskSeverity,
  isValidCommitRefs,
  normalizeCommitRefs,
} from '@plandesk/db';
import type { TaskService } from '../services/tasks.js';
import { InvalidCommitRefsError } from '../services/tasks.js';
import { InvalidTagError } from '../services/tags.js';

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function createTasksRouter(taskService: TaskService): Hono {
  const router = new Hono();

  router.patch('/tasks/:id', async (c) => {
    const body = await c.req.json<{
      status?: string;
      kind?: string;
      priority?: string | null;
      lane?: string | null;
      severity?: string | null;
      label?: string;
      description?: string | null;
      x?: number;
      y?: number;
      tags?: unknown;
      commit_refs?: unknown;
    }>();

    if (body.status !== undefined && !isTaskStatus(body.status)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.kind !== undefined && !isTaskKind(body.kind)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (
      body.priority !== undefined &&
      body.priority !== null &&
      !isTaskPriority(body.priority)
    ) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.lane !== undefined && body.lane !== null && !isTaskLane(body.lane)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.severity !== undefined && body.severity !== null && !isTaskSeverity(body.severity)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (body.tags !== undefined && !isStringArray(body.tags)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    let commitRefs: string[] | null | undefined;
    if (body.commit_refs === undefined) {
      commitRefs = undefined;
    } else if (body.commit_refs === null) {
      commitRefs = null;
    } else if (isStringArray(body.commit_refs) && isValidCommitRefs(body.commit_refs)) {
      commitRefs = normalizeCommitRefs(body.commit_refs);
    } else {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const task = await taskService.update(c.req.param('id'), {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.lane !== undefined ? { lane: body.lane } : {}),
        ...(body.severity !== undefined ? { severity: body.severity } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.x !== undefined ? { x: body.x } : {}),
        ...(body.y !== undefined ? { y: body.y } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(commitRefs !== undefined ? { commitRefs } : {}),
      });

      if (!task) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(task);
    } catch (error) {
      if (
        error instanceof InvalidTaskStatusError ||
        error instanceof InvalidTaskKindError ||
        error instanceof InvalidTaskPriorityError ||
        error instanceof InvalidTaskLaneError ||
        error instanceof InvalidTaskSeverityError ||
        error instanceof InvalidTagError ||
        error instanceof InvalidCommitRefsError ||
        error instanceof UnstoredColumnError
      ) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.delete('/tasks/:id', async (c) => {
    const deleted = await taskService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  router.post('/tasks/:id/claim', async (c) => {
    const body = await c.req.json<{ agent_ref?: string }>();
    if (typeof body.agent_ref !== 'string' || body.agent_ref.length === 0) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const result = await taskService.claim(c.req.param('id'), body.agent_ref);
    if (result === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (!result.claimed) {
      return c.json(result, 409);
    }
    return c.json(result);
  });

  return router;
}
