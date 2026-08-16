import { normalizeServerUrl } from './connect-artifacts.js';
import { resolveRegisteredRepoRoot } from './repo-root.js';

export class FolderPathSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderPathSyncError';
  }
}

export type SyncRepoFolderPathResult =
  | { status: 'set' | 'unchanged'; folderPath: string }
  | { status: 'conflict'; existing: string; attempted: string };

function isLoopbackServerUrl(serverUrl: string): boolean {
  try {
    const host = new URL(normalizeServerUrl(serverUrl)).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

export async function syncRepoFolderPathViaApi(
  serverUrl: string,
  projectId: string,
  repoDir: string,
  bearerToken?: string,
  useLoopbackOwner = false,
): Promise<SyncRepoFolderPathResult> {
  const folderPath = resolveRegisteredRepoRoot(repoDir);
  const headers: Record<string, string> = {};
  const authToken = useLoopbackOwner && isLoopbackServerUrl(serverUrl) ? undefined : bearerToken;
  if (authToken !== undefined && authToken !== '') {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const base = normalizeServerUrl(serverUrl);
  const getResponse = await fetch(`${base}/api/v1/projects/${encodeURIComponent(projectId)}`, {
    headers,
  });
  if (!getResponse.ok) {
    throw new FolderPathSyncError(
      `Failed to read project ${projectId} on ${serverUrl} (${String(getResponse.status)}).`,
    );
  }
  const project = (await getResponse.json()) as { folder_path: string | null };
  if (project.folder_path === folderPath) {
    return { status: 'unchanged', folderPath };
  }
  if (project.folder_path !== null && project.folder_path !== folderPath) {
    return { status: 'conflict', existing: project.folder_path, attempted: folderPath };
  }
  const patchResponse = await fetch(`${base}/api/v1/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_path: folderPath }),
  });
  if (!patchResponse.ok) {
    throw new FolderPathSyncError(
      `Failed to record folder_path for project ${projectId} (${String(patchResponse.status)}).`,
    );
  }
  return { status: 'set', folderPath };
}

export function folderPathSyncWarning(result: SyncRepoFolderPathResult): string | undefined {
  if (result.status !== 'conflict') {
    return undefined;
  }
  return (
    `warning: project folder_path is already ${result.existing}; ` +
    `not overwriting with ${result.attempted}`
  );
}
