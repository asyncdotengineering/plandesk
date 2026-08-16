import { describe, expect, it } from 'vitest';
import { AGENT_RUN_HEADER, BoardError, createBoardClient } from './board.js';
import type { RunnerConfig } from './config.js';

/**
 * The HTTP client is asserted against an injected fetch, one route per test —
 * the loop's use of the board is asserted against a stub client in
 * loop.test.ts; the real board is exercised in a later task.
 */

const BOARD_URL = 'https://board.example.invalid';
const AGENT_KEY = 'sk-test-board-key';

function makeConfig(): RunnerConfig {
  return {
    boardUrl: `${BOARD_URL}/`, // trailing slash must be trimmed
    agentKey: AGENT_KEY,
    name: 'test-runner',
    workdir: '/tmp/unused',
    workers: [],
    slots: 1,
    pollMs: 2000,
    leaseMs: 30000,
    heartbeatMs: 10000,
    attemptTimeoutMs: 3600000,
    repos: [],
    labels: {},
  };
}

interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Route {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  /** Return a non-JSON body (simulates a proxy or an HTML error page). */
  rawBody?: string;
}

function makeFetch(routes: Route[]): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const path = url.slice(BOARD_URL.length);
    calls.push({
      method: init?.method ?? 'GET',
      path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const route = routes.find(
      (candidate) => candidate.method === (init?.method ?? 'GET') && candidate.path === path,
    );
    if (route === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    }
    if (route.rawBody !== undefined) {
      return Promise.resolve(new Response(route.rawBody, { status: route.status ?? 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 }),
    );
  };
  return { impl, calls };
}

const TASK: Record<string, unknown> = {
  id: 'task-1',
  project_id: 'proj-1',
  goal_id: null,
  label: 'Write the thing',
  status: 'todo',
  kind: 'feature',
  priority: null,
  lane: 'auto',
  severity: null,
  description: 'gate: pnpm test',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('createBoardClient', () => {
  it('fetches the next task from /projects/:id/next-task with the bearer credential', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/next-task',
        body: { next_task: TASK, reason: 'ok', blocked: [] },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    const task = await board.nextTask();

    expect(task).toMatchObject({ id: 'task-1', label: 'Write the thing', lane: 'auto' });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/projects/proj-1/next-task' });
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${AGENT_KEY}`);
  });

  it('resolves null when the board reports no next task', async () => {
    const { impl } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/next-task',
        body: { next_task: null, reason: 'no_tasks', blocked: [] },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await expect(board.nextTask()).resolves.toBeNull();
  });

  it('raises BoardError naming the field when next_task is malformed', async () => {
    const { impl } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/next-task',
        body: { next_task: { id: 'task-1' } },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    // Validators run in wire order: project_id is the first required field
    // missing after id, so that is the field the error must name.
    await expect(board.nextTask()).rejects.toMatchObject({
      name: 'BoardError',
      field: 'next_task.project_id',
    });
  });

  it('claims via POST /tasks/:id/claim with agent_ref, mapping 409 to a lost race', async () => {
    const won = makeFetch([
      { method: 'POST', path: '/api/v1/tasks/task-1/claim', body: { claimed: true, task: TASK } },
    ]);
    const boardWon = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: won.impl });
    const claim = await boardWon.claimTask('task-1', 'runner-a');

    expect(claim.claimed).toBe(true);
    if (claim.claimed) {
      expect(claim.task.id).toBe('task-1');
    }
    expect(won.calls[0]?.body).toBe(JSON.stringify({ agent_ref: 'runner-a' }));

    const lost = makeFetch([
      {
        method: 'POST',
        path: '/api/v1/tasks/task-1/claim',
        status: 409,
        body: { claimed: false, reason: 'taken_or_not_actionable' },
      },
    ]);
    const boardLost = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: lost.impl });
    await expect(boardLost.claimTask('task-1', 'runner-a')).resolves.toEqual({ claimed: false });
  });

  it('raises BoardError naming claimed when the claim response shape is wrong', async () => {
    const { impl } = makeFetch([
      { method: 'POST', path: '/api/v1/tasks/task-1/claim', body: { task: TASK } },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await expect(board.claimTask('task-1', 'runner-a')).rejects.toMatchObject({
      name: 'BoardError',
      field: 'claimed',
    });
  });

  it('sets status via PATCH /tasks/:id carrying the agent-run header', async () => {
    const { impl, calls } = makeFetch([
      { method: 'PATCH', path: '/api/v1/tasks/task-1', body: { ...TASK, status: 'done' } },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await board.setTaskStatus('task-1', 'done', 'run-9');

    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/v1/tasks/task-1' });
    expect(calls[0]?.body).toBe(JSON.stringify({ status: 'done' }));
    expect(calls[0]?.headers[AGENT_RUN_HEADER]).toBe('run-9');
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${AGENT_KEY}`);
  });

  it('reads the project (repo_url decides where work happens)', async () => {
    const { impl } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1',
        body: { id: 'proj-1', name: 'Fixture', repo_url: 'https://github.com/acme/widget.git' },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await expect(board.project()).resolves.toEqual({
      id: 'proj-1',
      name: 'Fixture',
      repo_url: 'https://github.com/acme/widget.git',
    });
  });

  it('starts a run via POST /projects/:id/agent-runs', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'POST',
        path: '/api/v1/projects/proj-1/agent-runs',
        body: {
          id: 'run-1',
          project_id: 'proj-1',
          status: 'running',
          label: 'attempt',
          started_at: '2026-01-01T00:00:00.000Z',
          completed_at: null,
        },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    const run = await board.startRun('attempt');

    expect(run).toMatchObject({ id: 'run-1', status: 'running' });
    expect(calls[0]?.body).toBe(JSON.stringify({ label: 'attempt' }));
  });

  it('records progress via POST /agent-runs/:id/progress (not /events) with the run header', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'POST',
        path: '/api/v1/agent-runs/run-1/progress',
        status: 201,
        body: { id: 'ev-1', message: 'hi', created_at: '2026-01-01T00:00:00.000Z' },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await board.recordProgress('run-1', 'heartbeat: still running');

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/agent-runs/run-1/progress' });
    expect(calls[0]?.body).toBe(JSON.stringify({ message: 'heartbeat: still running' }));
    expect(calls[0]?.headers[AGENT_RUN_HEADER]).toBe('run-1');
  });

  it('completes a run via PATCH /agent-runs/:id', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'PATCH',
        path: '/api/v1/agent-runs/run-1',
        body: {
          id: 'run-1',
          project_id: 'proj-1',
          status: 'completed',
          label: null,
          started_at: '2026-01-01T00:00:00.000Z',
          completed_at: '2026-01-01T00:01:00.000Z',
        },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await board.completeRun('run-1', 'completed');

    expect(calls[0]?.body).toBe(JSON.stringify({ status: 'completed' }));
    expect(calls[0]?.headers[AGENT_RUN_HEADER]).toBe('run-1');
  });

  it('lists every task via GET /projects/:id/tasks (there is no single-task GET route)', async () => {
    const { impl, calls } = makeFetch([
      { method: 'GET', path: '/api/v1/projects/proj-1/tasks', body: [TASK] },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    const tasks = await board.listTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'task-1', status: 'todo', lane: 'auto' });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/projects/proj-1/tasks' });
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${AGENT_KEY}`);
  });

  it('raises BoardError naming the array element when a listed task is malformed', async () => {
    const { impl } = makeFetch([
      { method: 'GET', path: '/api/v1/projects/proj-1/tasks', body: [{ id: 'task-1' }] },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await expect(board.listTasks()).rejects.toMatchObject({
      name: 'BoardError',
      field: 'tasks[0].project_id',
    });
  });

  it('lists agent runs via GET /projects/:id/agent-runs, newest first, trimming events', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/agent-runs',
        body: [
          {
            id: 'run-2',
            project_id: 'proj-1',
            status: 'running',
            label: 'task task-1: Write the thing',
            started_at: '2026-01-02T00:00:00.000Z',
            completed_at: null,
            events: [{ id: 'ev-1', message: 'heartbeat', created_at: '2026-01-02T00:00:01.000Z' }],
          },
        ],
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    const runs = await board.listRuns();

    expect(runs).toEqual([
      {
        id: 'run-2',
        project_id: 'proj-1',
        status: 'running',
        label: 'task task-1: Write the thing',
        started_at: '2026-01-02T00:00:00.000Z',
        completed_at: null,
      },
    ]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/projects/proj-1/agent-runs' });
  });

  it('reads the linked task document, mapping 404 to null', async () => {
    const found = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/tasks/task-1/document',
        body: {
          id: 'doc-1',
          project_id: 'proj-1',
          title: 'Spec',
          body: 'The body',
          status_line: 'Draft',
        },
      },
    ]);
    const boardFound = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: found.impl });
    await expect(boardFound.taskDocument('task-1')).resolves.toMatchObject({
      id: 'doc-1',
      body: 'The body',
    });

    const missing = makeFetch([]);
    const boardMissing = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: missing.impl });
    await expect(boardMissing.taskDocument('task-1')).resolves.toBeNull();
  });

  it('raises BoardError with the status for unexpected HTTP failures', async () => {
    const { impl } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/next-task',
        status: 500,
        body: { error: 'boom' },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    const error = await board.nextTask().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BoardError);
    const boardError = error as BoardError;
    expect(boardError.field).toBe('http');
    expect(boardError.status).toBe(500);
    expect(boardError.message).not.toContain(AGENT_KEY);
  });

  it('raises BoardError for transport failures and non-JSON bodies', async () => {
    const failing: typeof fetch = () => Promise.reject(new Error('connection refused'));
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: failing });
    await expect(board.nextTask()).rejects.toMatchObject({ name: 'BoardError', field: 'http' });

    const { impl } = makeFetch([
      { method: 'GET', path: '/api/v1/projects/proj-1/next-task', rawBody: '<html>gateway</html>' },
    ]);
    const htmlBoard = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });
    await expect(htmlBoard.nextTask()).rejects.toMatchObject({ name: 'BoardError', field: 'http' });
  });

  it('encodes path segments so an id can never break out of the route', async () => {
    const { impl, calls } = makeFetch([]);
    const board = createBoardClient(makeConfig(), 'proj 1', { fetchImpl: impl });

    await board.taskDocument('a/b c').catch(() => undefined);

    expect(calls[0]?.path).toBe('/api/v1/tasks/a%2Fb%20c/document');
  });

  it('sends no Authorization header when the agent key is empty (loopback path)', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/next-task',
        body: { next_task: null, reason: 'no_tasks', blocked: [] },
      },
    ]);
    const board = createBoardClient({ ...makeConfig(), agentKey: '' }, 'proj-1', {
      fetchImpl: impl,
    });

    await board.nextTask();

    // Absent, not empty: `Bearer ` with no value is a stranger bearer and 401s.
    expect(calls[0]?.headers).not.toHaveProperty('Authorization');
    expect(JSON.stringify(calls[0]?.headers)).not.toContain('Bearer');
  });

  it('still sends the bearer credential when the agent key is non-empty', async () => {
    const { impl, calls } = makeFetch([
      {
        method: 'GET',
        path: '/api/v1/projects/proj-1/next-task',
        body: { next_task: null, reason: 'no_tasks', blocked: [] },
      },
    ]);
    const board = createBoardClient(makeConfig(), 'proj-1', { fetchImpl: impl });

    await board.nextTask();

    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${AGENT_KEY}`);
  });
});
