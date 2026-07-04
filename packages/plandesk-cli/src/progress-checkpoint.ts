import { normalizeServerUrl, resolvePlandeskBinding } from './connect-artifacts.js';

export const DEFAULT_CHECKPOINT_MESSAGE = 'checkpoint (hook)';

export type ProgressCheckpointResult = {
  posted: boolean;
};

type AgentRunResponse = { id: string; status: string };

// Posts a best-effort progress checkpoint to the bound project's currently
// running agent run — the durable state a Stop/PreCompact hook writes before
// it's lost. No-ops (posted: false) when idle: no binding, server
// unreachable, or no agent run in `running` status. Never throws.
export async function runProgressCheckpoint(
  repoDir: string,
  message: string,
): Promise<ProgressCheckpointResult> {
  const binding = resolvePlandeskBinding(repoDir);
  if (!binding) {
    return { posted: false };
  }
  const { config, token } = binding;
  const base = normalizeServerUrl(config.serverUrl);

  let runs: AgentRunResponse[] | undefined;
  try {
    const res = await fetch(`${base}/api/v1/projects/${config.projectId}/agent-runs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { posted: false };
    }
    runs = (await res.json()) as AgentRunResponse[];
  } catch {
    return { posted: false };
  }

  // Runs are returned most-recent-first, so the first "running" entry is the
  // most recently started one.
  const runningRun = runs.find((run) => run.status === 'running');
  if (!runningRun) {
    return { posted: false };
  }

  try {
    const res = await fetch(`${base}/api/v1/agent-runs/${runningRun.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    });
    return { posted: res.ok };
  } catch {
    return { posted: false };
  }
}
