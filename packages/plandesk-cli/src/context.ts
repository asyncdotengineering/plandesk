import { normalizeServerUrl, resolvePlandeskBinding } from './connect-artifacts.js';

export type CurrentTaskSummary = {
  id: string;
  label: string;
  status: string;
};

export type LinkedDocSummary = {
  id: string;
  title: string;
  status_line: string | null;
  body: string | null;
};

export type LastProgressSummary = {
  message: string;
  created_at: string;
};

export type NextTaskSummary = {
  id: string;
  label: string;
};

export type PlanDeskContext = {
  current_task: CurrentTaskSummary | null;
  linked_doc: LinkedDocSummary | null;
  last_progress: LastProgressSummary | null;
  next_task: NextTaskSummary | null;
};

type TaskResponse = { id: string; label: string; status: string; updated_at: string };
type DocumentResponse = { id: string; title: string; status_line: string | null; body: string | null };
type AgentRunEventResponse = { message: string; created_at: string };
type AgentRunResponse = { status: string; started_at: string; events: AgentRunEventResponse[] };
type NextTaskResponse = { next_task: { id: string; label: string } | null };

// A hook script must never hang a session on a reachable-but-wedged server
// (mid-restart, overloaded, black-holed) — fetch has no default timeout, so
// one is set explicitly; a timeout is just another no-op path via the catch.
const HOOK_FETCH_TIMEOUT_MS = 2000;

async function fetchJson<T>(url: string, token?: string): Promise<T | undefined> {
  try {
    const headers: Record<string, string> = {};
    if (token !== undefined && token !== '') {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(HOOK_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return undefined;
    }
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

// At most one task is meaningfully "current" — if more than one is in_progress
// (shouldn't normally happen), pick the most recently updated one rather than
// building a policy for it.
function mostRecentlyUpdated(tasks: TaskResponse[]): TaskResponse | undefined {
  return tasks
    .slice()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
}

function mostRecentEvent(events: AgentRunEventResponse[]): AgentRunEventResponse | undefined {
  // listAgentRunEvents returns events in insertion order with no ORDER BY;
  // sort ascending (stable) so same-millisecond ties keep that insertion
  // order, then take the last one — the actual most recent event.
  const sorted = events
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return sorted[sorted.length - 1];
}

// The linked doc is injected into agent context on every SessionStart (including
// post-compaction). Cap the body so a large doc (e.g. a full RFC) doesn't re-inflate
// the context it was just compacted out of.
const MAX_DOC_BODY_CHARS = 4000;

function capBody(body: string | null): string | null {
  if (body === null || body.length <= MAX_DOC_BODY_CHARS) {
    return body;
  }
  return `${body.slice(0, MAX_DOC_BODY_CHARS)}\n\n…[truncated — open the linked doc in Plan Desk for the full body]`;
}

// Reads the bound project's board state for re-anchoring an agent across
// compaction: the current in_progress task, its linked doc, the most recent
// agent-run progress message, and (when idle) the next actionable task.
// Returns {} when the repo isn't bound or its config is unreadable — an idle
// no-op, never an error: a hook must never fail a session start.
export async function runContext(repoDir: string): Promise<PlanDeskContext | Record<string, never>> {
  const binding = (() => {
    try {
      return resolvePlandeskBinding(repoDir);
    } catch {
      return undefined;
    }
  })();
  if (!binding) {
    return {};
  }
  const { config, token } = binding;
  const base = normalizeServerUrl(config.serverUrl);

  // tasks and agent-runs are independent — fetch them together instead of serially.
  const [tasks, runs] = await Promise.all([
    fetchJson<TaskResponse[]>(
      `${base}/api/v1/projects/${config.projectId}/tasks?status=in_progress`,
      token,
    ),
    fetchJson<AgentRunResponse[]>(`${base}/api/v1/projects/${config.projectId}/agent-runs`, token),
  ]);

  const currentTaskRaw = mostRecentlyUpdated(tasks ?? []);

  // The current task's doc and the idle next-task are mutually exclusive — only one runs.
  let currentTask: CurrentTaskSummary | null = null;
  let linkedDoc: LinkedDocSummary | null = null;
  let nextTask: NextTaskSummary | null = null;
  if (currentTaskRaw) {
    currentTask = {
      id: currentTaskRaw.id,
      label: currentTaskRaw.label,
      status: currentTaskRaw.status,
    };
    const doc = await fetchJson<DocumentResponse>(
      `${base}/api/v1/tasks/${currentTaskRaw.id}/document`,
      token,
    );
    if (doc) {
      linkedDoc = {
        id: doc.id,
        title: doc.title,
        status_line: doc.status_line,
        body: capBody(doc.body),
      };
    }
  } else {
    const nextTaskResult = await fetchJson<NextTaskResponse>(
      `${base}/api/v1/projects/${config.projectId}/next-task`,
      token,
    );
    if (nextTaskResult?.next_task) {
      nextTask = { id: nextTaskResult.next_task.id, label: nextTaskResult.next_task.label };
    }
  }

  let lastProgress: LastProgressSummary | null = null;
  // Runs are returned most-recent-first; the last progress message is the
  // latest event on the most recent run.
  const latestEvent = runs?.[0] ? mostRecentEvent(runs[0].events) : undefined;
  if (latestEvent) {
    lastProgress = { message: latestEvent.message, created_at: latestEvent.created_at };
  }

  return {
    current_task: currentTask,
    linked_doc: linkedDoc,
    last_progress: lastProgress,
    next_task: nextTask,
  };
}
