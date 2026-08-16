import type { RunnerConfig } from './config.js';

/**
 * The runner's typed window onto the Plan Desk board.
 *
 * A thin client over the REST surface in `packages/plandesk-api/src/routes/`
 * (mounted under `/api/v1`): it holds the credential — nobody else in this
 * package ever sees `config.agentKey` — and nothing else. Every method maps
 * one call; the loop module (`./loop.ts`) owns all sequencing decisions.
 *
 * Route conformance notes, verified against the API package (the sketch in
 * the build contract is corrected here):
 *
 * - Next task is `GET /projects/:id/next-task` returning
 *   `{ next_task, reason, blocked }` — not `/tasks/next`.
 * - Claim is `POST /tasks/:id/claim` with `{ agent_ref }`; the race loser
 *   gets HTTP 409 with `{ claimed: false }`, the winner 200 with the task.
 * - `PATCH /tasks/:id` accepts `status` only — there is no `note` field, so
 *   outcome notes travel as agent-run progress events instead.
 * - Progress is `POST /agent-runs/:id/progress` with `{ message }` — not
 *   `/events`.
 * - Task-status writes made under an agent key must carry
 *   `x-plandesk-agent-run-id` naming a *running* run (the API resolves the
 *   write actor from that header; without it the write is rejected), so the
 *   methods that mutate within a run take the run id and attach the header.
 */

/** Header the API reads to attribute agent-key writes to a run. */
export const AGENT_RUN_HEADER = 'x-plandesk-agent-run-id';

/** Task statuses the board stores (`taskStatuses` in @plandesk/db). */
export type TaskStatus = 'scope' | 'todo' | 'in_progress' | 'done' | 'backlog';

/** Risk lanes (`taskLanes` in @plandesk/db — see .agents/factory/lanes.md). */
export type TaskLane = 'auto' | 'approve' | 'full';

/** Agent-run statuses the board stores (`agentRunStatuses` in @plandesk/db). */
export type AgentRunStatus = 'running' | 'completed' | 'failed';

/**
 * A board task, in the wire (snake_case) shape `serializeTask` emits. Status
 * and lane are typed `string` because the board may add values the runner
 * does not know; the runner's own writes use the closed types above and the
 * unknown values fall through fail-closed paths.
 */
export interface BoardTask {
  id: string;
  project_id: string;
  goal_id: string | null;
  label: string;
  status: string;
  kind: string;
  priority: string | null;
  lane: string | null;
  severity: string | null;
  description: string | null;
}

/** The project the runner is bound to — `serializeProject` wire shape, trimmed. */
export interface BoardProject {
  id: string;
  name: string;
  /** Repository the project's work happens in; null when unbound. */
  repo_url: string | null;
}

/** A linked document in the `serializeDocument` wire shape, trimmed. */
export interface BoardDocument {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status_line: string | null;
}

/** An agent run in the `serializeAgentRun` wire shape, trimmed. */
export interface BoardAgentRun {
  id: string;
  project_id: string;
  status: string;
  label: string | null;
  started_at: string;
  completed_at: string | null;
}

/** Result of claiming: the loser of a race gets `{ claimed: false }`. */
export type ClaimResult = { claimed: true; task: BoardTask } | { claimed: false };

/**
 * Raised for transport failures, unexpected HTTP statuses, and wire shapes
 * that do not match the routes this client is coded against. `field` names
 * the offending thing — `'http'` for a transport/status problem, or the
 * dotted wire path of a malformed field (`'next_task.lane'`), mirroring
 * ConfigError/WorktreeError in this package.
 */
export class BoardError extends Error {
  readonly field: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  /** Truncated response body, for diagnostics; never contains the agent key. */
  readonly body?: string;

  constructor(
    field: string,
    method: string,
    path: string,
    message: string,
    options?: { status?: number; body?: string; cause?: unknown },
  ) {
    super(message, options !== undefined ? { cause: options.cause } : undefined);
    this.name = 'BoardError';
    this.field = field;
    this.method = method;
    this.path = path;
    this.status = options?.status;
    this.body = options?.body;
  }
}

/** Options for {@link createBoardClient}. */
export interface BoardClientOptions {
  /** Injectable fetch for tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default: 30000. */
  timeoutMs?: number;
}

const DEFAULT_BOARD_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_CHARS = 2000;

/**
 * The board surface the loop drives. `runOnce`/`runLoop` accept any
 * implementation — the real HTTP client from {@link createBoardClient}, or a
 * stub in tests. One client instance is bound to one project, because the
 * board's REST surface is project-scoped and agent keys are minted
 * project-scoped (`createScopedAgentKey`).
 */
export interface BoardClient {
  /** The next actionable task on the bound project, or null when none. */
  nextTask(): Promise<BoardTask | null>;
  /**
   * Atomically claim a todo task for `agentRef`. Losing the race resolves
   * `{ claimed: false }` — never throws for a race loss.
   */
  claimTask(taskId: string, agentRef: string): Promise<ClaimResult>;
  /** Set a task's status. `runId` attributes the write (`AGENT_RUN_HEADER`). */
  setTaskStatus(taskId: string, status: TaskStatus, runId: string): Promise<void>;
  /** The bound project (its `repo_url` decides where work happens). */
  project(): Promise<BoardProject>;
  /** Start an agent run on the bound project. */
  startRun(label?: string): Promise<BoardAgentRun>;
  /** Record one progress event on a run. */
  recordProgress(runId: string, message: string): Promise<void>;
  /** Complete a run with a terminal status. */
  completeRun(runId: string, status: 'completed' | 'failed'): Promise<void>;
  /** The document linked to a task, or null when the task has none. */
  taskDocument(taskId: string): Promise<BoardDocument | null>;
  /**
   * Every task on the bound project (`GET /projects/:id/tasks`, the bare
   * `serializeTask` array). There is no single-task GET route, so reads of
   * one task by id resolve through this list.
   */
  listTasks(): Promise<BoardTask[]>;
  /**
   * Every agent run on the bound project (`GET /projects/:id/agent-runs`),
   * newest first — the service sorts by started_at desc, id desc. The wire
   * rows carry an `events` array the runner does not read; it is trimmed.
   */
  listRuns(): Promise<BoardAgentRun[]>;
}

function requireString(source: Record<string, unknown>, key: string, field: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BoardError(
      field,
      'GET',
      '',
      `board response field ${field} must be a non-empty string — got ${
        value === undefined ? 'undefined' : JSON.stringify(value)
      }`,
    );
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string, field: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BoardError(
      field,
      'GET',
      '',
      `board response field ${field} must be a string or null — got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Parse a wire task: the fields the runner reads, validated and copied. */
function parseTask(raw: unknown, field: string): BoardTask {
  if (typeof raw !== 'object' || raw === null) {
    throw new BoardError(
      field,
      'GET',
      '',
      `board response field ${field} must be an object — got ${JSON.stringify(raw)}`,
    );
  }
  const source = raw as Record<string, unknown>;
  const wrap = (key: string): string => `${field}.${key}`;
  return {
    id: requireString(source, 'id', wrap('id')),
    project_id: requireString(source, 'project_id', wrap('project_id')),
    goal_id: optionalString(source, 'goal_id', wrap('goal_id')),
    label: requireString(source, 'label', wrap('label')),
    status: requireString(source, 'status', wrap('status')),
    kind: requireString(source, 'kind', wrap('kind')),
    priority: optionalString(source, 'priority', wrap('priority')),
    lane: optionalString(source, 'lane', wrap('lane')),
    severity: optionalString(source, 'severity', wrap('severity')),
    description: optionalString(source, 'description', wrap('description')),
  };
}

/** Parse a wire agent run: the fields the runner reads, validated and copied. */
function parseAgentRun(raw: unknown, field: string): BoardAgentRun {
  if (typeof raw !== 'object' || raw === null) {
    throw new BoardError(
      field,
      'GET',
      '',
      `board response field ${field} must be an object — got ${JSON.stringify(raw)}`,
    );
  }
  const source = raw as Record<string, unknown>;
  const wrap = (key: string): string => `${field}.${key}`;
  return {
    id: requireString(source, 'id', wrap('id')),
    project_id: requireString(source, 'project_id', wrap('project_id')),
    status: requireString(source, 'status', wrap('status')),
    label: optionalString(source, 'label', wrap('label')),
    started_at: requireString(source, 'started_at', wrap('started_at')),
    completed_at: optionalString(source, 'completed_at', wrap('completed_at')),
  };
}

interface RequestSpec {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  /** Run id attached as AGENT_RUN_HEADER for write attribution. */
  runId?: string;
}

/**
 * Create the HTTP {@link BoardClient} for one board and one project.
 * Base URL comes from `config.boardUrl`; every request carries
 * `Authorization: Bearer <config.agentKey>` — the only place the key is read.
 */
export function createBoardClient(
  config: RunnerConfig,
  projectId: string,
  options: BoardClientOptions = {},
): BoardClient {
  const base = `${config.boardUrl.trim().replace(/\/+$/, '')}/api/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOARD_TIMEOUT_MS;

  async function request(spec: RequestSpec): Promise<unknown> {
    const path = spec.path;
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: spec.method,
        headers: {
          Accept: 'application/json',
          ...(spec.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${config.agentKey}`,
          ...(spec.runId !== undefined ? { [AGENT_RUN_HEADER]: spec.runId } : {}),
        },
        body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new BoardError(
        'http',
        spec.method,
        path,
        `board request ${spec.method} ${path} failed: ${(cause as Error).message}`,
        { cause },
      );
    }

    if (response.status === 204) {
      return undefined;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new BoardError(
        'http',
        spec.method,
        path,
        `board request ${spec.method} ${path} returned HTTP ${String(response.status)}`,
        { status: response.status, body: text.slice(0, MAX_ERROR_BODY_CHARS) },
      );
    }
    if (text.trim().length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new BoardError('http', spec.method, path, `board response for ${path} is not JSON`, {
        status: response.status,
        body: text.slice(0, MAX_ERROR_BODY_CHARS),
        cause,
      });
    }
  }

  async function requestJson(spec: RequestSpec): Promise<Record<string, unknown>> {
    const parsed = await request(spec);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BoardError('http', spec.method, spec.path, `board response for ${spec.path} is not an object`, {
        status: 200,
      });
    }
    return parsed as Record<string, unknown>;
  }

  /** Fetch, treating one expected status (e.g. 409, 404) as a value, not an error. */
  async function requestAllowStatus(
    spec: RequestSpec,
    allowedStatus: number,
  ): Promise<{ status: number; body: Record<string, unknown> | undefined }> {
    try {
      return { status: 200, body: await requestJson(spec) };
    } catch (error) {
      if (error instanceof BoardError && error.status === allowedStatus) {
        return { status: allowedStatus, body: undefined };
      }
      throw error;
    }
  }

  const encodedProjectId = encodeURIComponent(projectId);

  return {
    async nextTask(): Promise<BoardTask | null> {
      const path = `/projects/${encodedProjectId}/next-task`;
      const body = await requestJson({ method: 'GET', path });
      const next = body['next_task'];
      if (next === undefined || next === null) {
        return null;
      }
      return parseTask(next, 'next_task');
    },

    async claimTask(taskId: string, agentRef: string): Promise<ClaimResult> {
      const path = `/tasks/${encodeURIComponent(taskId)}/claim`;
      const { status, body } = await requestAllowStatus(
        { method: 'POST', path, body: { agent_ref: agentRef } },
        409,
      );
      if (status === 409) {
        return { claimed: false };
      }
      const source = body ?? {};
      const claimed = source['claimed'];
      if (typeof claimed !== 'boolean') {
        throw new BoardError(
          'claimed',
          'POST',
          path,
          `board response for ${path} field claimed must be a boolean — got ${JSON.stringify(claimed)}`,
        );
      }
      if (!claimed) {
        return { claimed: false };
      }
      return { claimed: true, task: parseTask(source['task'], 'task') };
    },

    async setTaskStatus(taskId: string, status: TaskStatus, runId: string): Promise<void> {
      await requestJson({
        method: 'PATCH',
        path: `/tasks/${encodeURIComponent(taskId)}`,
        body: { status },
        runId,
      });
    },

    async project(): Promise<BoardProject> {
      const path = `/projects/${encodedProjectId}`;
      const body = await requestJson({ method: 'GET', path });
      return {
        id: requireString(body, 'id', 'id'),
        name: requireString(body, 'name', 'name'),
        repo_url: optionalString(body, 'repo_url', 'repo_url'),
      };
    },

    async startRun(label?: string): Promise<BoardAgentRun> {
      const path = `/projects/${encodedProjectId}/agent-runs`;
      const body = await requestJson({
        method: 'POST',
        path,
        body: label === undefined ? {} : { label },
      });
      return parseAgentRun(body, 'agent_run');
    },

    async recordProgress(runId: string, message: string): Promise<void> {
      await requestJson({
        method: 'POST',
        path: `/agent-runs/${encodeURIComponent(runId)}/progress`,
        body: { message },
        runId,
      });
    },

    async completeRun(runId: string, status: 'completed' | 'failed'): Promise<void> {
      await requestJson({
        method: 'PATCH',
        path: `/agent-runs/${encodeURIComponent(runId)}`,
        body: { status },
        runId,
      });
    },

    async taskDocument(taskId: string): Promise<BoardDocument | null> {
      const path = `/tasks/${encodeURIComponent(taskId)}/document`;
      const { status, body } = await requestAllowStatus({ method: 'GET', path }, 404);
      if (status === 404) {
        return null;
      }
      const source = body ?? {};
      return {
        id: requireString(source, 'id', 'id'),
        project_id: requireString(source, 'project_id', 'project_id'),
        title: requireString(source, 'title', 'title'),
        body: requireString(source, 'body', 'body'),
        status_line: optionalString(source, 'status_line', 'status_line'),
      };
    },

    async listTasks(): Promise<BoardTask[]> {
      const path = `/projects/${encodedProjectId}/tasks`;
      const parsed = await request({ method: 'GET', path });
      if (!Array.isArray(parsed)) {
        throw new BoardError(
          'tasks',
          'GET',
          path,
          `board response for ${path} must be an array — got ${JSON.stringify(parsed).slice(0, 100)}`,
        );
      }
      return parsed.map((entry, index) => parseTask(entry, `tasks[${String(index)}]`));
    },

    async listRuns(): Promise<BoardAgentRun[]> {
      const path = `/projects/${encodedProjectId}/agent-runs`;
      const parsed = await request({ method: 'GET', path });
      if (!Array.isArray(parsed)) {
        throw new BoardError(
          'agent_runs',
          'GET',
          path,
          `board response for ${path} must be an array — got ${JSON.stringify(parsed).slice(0, 100)}`,
        );
      }
      return parsed.map((entry, index) => parseAgentRun(entry, `agent_runs[${String(index)}]`));
    },
  };
}
