import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createTestApp, parseJson } from '../test-helpers.js';

/**
 * Contract: a service validation error reaches a REST caller as exactly
 * `400 {"error":"invalid_argument","message":…}` — byte for byte, whichever
 * route raised it. Raw text is compared so key order and absent keys count.
 */
function invalid(message: string): string {
  return JSON.stringify({ error: 'invalid_argument', message });
}

async function send(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

async function created<T extends { id: string }>(
  app: Hono,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`POST ${path} → ${String(res.status)}: ${await res.text()}`);
  }
  return parseJson<T>(res);
}

describe('service validation errors → REST invalid_argument', () => {
  it('maps every service validation family to the same 400 body', async () => {
    const { app } = await createTestApp();
    const project = await created<{ id: string }>(app, '/projects', { name: 'Contract' });
    const other = await created<{ id: string }>(app, '/projects', { name: 'Other' });
    const p = project.id;
    const task = await created<{ id: string }>(app, `/projects/${p}/tasks`, { label: 'T' });
    const otherTask = await created<{ id: string }>(app, `/projects/${other.id}/tasks`, {
      label: 'O',
    });
    const otherDoc = await created<{ id: string }>(app, `/projects/${other.id}/documents`, {
      title: 'O',
    });
    const goalId = randomUUID();

    const cases: Array<[string, Promise<{ status: number; text: string }>, string]> = [
      [
        'InvalidTagError',
        created(app, `/projects/${p}/tags`, { name: 'dup' }).then(() =>
          send(app, 'POST', `/projects/${p}/tags`, { name: 'dup' }),
        ),
        invalid('Tag already exists: dup'),
      ],
      [
        'InvalidPrototypeError',
        send(app, 'POST', `/projects/${p}/prototypes`, {
          name: 'P',
          viewport_width: -1,
          viewport_height: 10,
        }),
        invalid('Viewport width and height must be finite positive numbers'),
      ],
      [
        'InvalidFolderError',
        send(app, 'POST', `/projects/${p}/folders`, {
          name: 'F',
          parent_folder_id: randomUUID(),
        }),
        invalid('Parent folder does not belong to project'),
      ],
      [
        'InvalidCommentError',
        send(app, 'POST', `/tasks/${task.id}/comments`, { body: '   ' }),
        invalid('Comment body must not be empty'),
      ],
      [
        'InvalidCanvasError',
        send(app, 'POST', `/projects/${p}/edges`, {
          from_type: 'task',
          from_id: task.id,
          to_type: 'task',
          to_id: otherTask.id,
        }),
        invalid('Edge to task not found in project'),
      ],
      [
        'InvalidDocumentError',
        send(app, 'POST', `/projects/${p}/documents`, { title: 'D', parent_id: otherDoc.id }),
        invalid('Parent document does not belong to project'),
      ],
      [
        'InvalidArtifactError',
        send(app, 'POST', `/projects/${p}/artifacts`, {
          title: 'A',
          kind: 'markdown',
          content: 'x',
          prototype_id: randomUUID(),
        }),
        invalid('prototype_id does not belong to this project (unknown or cross-project)'),
      ],
      [
        'InvalidRevisionQueryError',
        send(app, 'GET', `/projects/${p}/revisions?target_type=bogus&target_id=x`),
        invalid('target_type must be task, document, or artifact'),
      ],
      [
        'InvalidGoalReferenceError',
        send(app, 'POST', `/projects/${p}/tasks`, { label: 'G', goal_id: goalId }),
        invalid(`Goal ${goalId} does not exist in this project`),
      ],
      [
        'InvalidVerificationError',
        send(app, 'PATCH', `/tasks/${task.id}`, { verified_ref: 'abc' }),
        invalid('verified_at is required when setting verified_ref'),
      ],
      [
        'InvalidExportRequestError',
        send(app, 'POST', `/projects/${p}/export`, { format: 'pdf', view: {} }),
        invalid('format must be csv or xlsx'),
      ],
    ];

    const actual: Record<string, { status: number; text: string }> = {};
    const expected: Record<string, { status: number; text: string }> = {};
    for (const [name, pending, text] of cases) {
      actual[name] = await pending;
      expected[name] = { status: 400, text };
    }
    expect(actual).toEqual(expected);
  });

  it('maps agent-run and goal transition errors to the same 400 body', async () => {
    const { app } = await createTestApp();
    const project = await created<{ id: string }>(app, '/projects', { name: 'Runs' });
    const run = await created<{ id: string }>(app, `/projects/${project.id}/agent-runs`, {
      label: 'W',
    });
    await send(app, 'PATCH', `/agent-runs/${run.id}`, { status: 'completed' });
    const goal = await created<{ id: string }>(app, `/projects/${project.id}/goals`, {
      objective: 'Ship',
      name: 'g1',
    });

    expect({
      run: await send(app, 'PATCH', `/agent-runs/${run.id}`, { status: 'completed' }),
      progress: await send(app, 'POST', `/agent-runs/${run.id}/progress`, { message: 'late' }),
      resume: await send(app, 'POST', `/goals/${goal.id}/resume`),
      duplicate: await send(app, 'POST', `/projects/${project.id}/goals`, {
        objective: 'Again',
        name: 'g1',
      }),
      surface: await send(app, 'PATCH', `/goals/${goal.id}`, { verification_surface: '{' }),
    }).toEqual({
      run: { status: 400, text: invalid('Agent run is already complete') },
      progress: { status: 400, text: invalid('Agent run is already complete') },
      resume: { status: 400, text: invalid('Goal can only be resumed from paused status') },
      duplicate: { status: 400, text: invalid('Goal name already exists in this project: g1') },
      surface: { status: 400, text: invalid('verification_surface must be valid JSON') },
    });
  });

  it('keeps the checklist-evidence body, which carries no message', async () => {
    const { app } = await createTestApp();
    const project = await created<{ id: string }>(app, '/projects', { name: 'Special' });
    const goal = await created<{ id: string }>(app, `/projects/${project.id}/goals`, {
      objective: 'Checklist',
      verification_surface: JSON.stringify({
        kind: 'acceptance_checklist',
        items: [{ criterion: 'works' }],
      }),
    });

    expect(
      await send(app, 'POST', `/goals/${goal.id}/complete`, {
        evidence: { kind: 'acceptance_checklist', checked: ['nope'] },
      }),
    ).toEqual({
      status: 400,
      text: JSON.stringify({ error: 'invalid_argument', unmatched: ['nope'], unmet: ['works'] }),
    });
  });
});
