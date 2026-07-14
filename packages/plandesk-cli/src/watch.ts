import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDefaultOrg, type Db } from '@plandesk/db';
import type { SyncService } from '@plandesk/api';
import { createServices } from '@plandesk/api';
import { normalizeServerUrl, parseConfigJson } from './connect-artifacts.js';
import { resolveSyncRemote } from './sync.js';

export class LocalServerUnreachableError extends Error {
  constructor() {
    super("Cannot reach local Plan Desk server. Is 'plandesk serve' running?");
    this.name = 'LocalServerUnreachableError';
  }
}

export class WatchDisconnectedError extends Error {
  constructor() {
    super('Local Plan Desk server watch poll disconnected. Restart plandesk sync --watch.');
    this.name = 'WatchDisconnectedError';
  }
}

/** @deprecated Use WatchDisconnectedError. Kept for existing callers. */
export class SseDisconnectedError extends WatchDisconnectedError {
  constructor() {
    super();
    this.name = 'SseDisconnectedError';
  }
}

export type WatchOptions = {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  globalProjectId?: string;
  syncToken?: string;
  localServerUrl?: string;
};

/** Yielded when a watched project's data may have changed. */
export type WatchChangeEvent = {
  projectId: string;
};

export type EventStream = {
  [Symbol.asyncIterator](): AsyncIterator<WatchChangeEvent>;
  close(): void;
};

export type WatchRunnerDeps = {
  createEventStream: (url: string, signal: AbortSignal) => Promise<EventStream>;
  syncService: Pick<SyncService, 'push' | 'watchPush'>;
  onSigint: (handler: () => void) => () => void;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  pollIntervalMs?: number;
};

const DEFAULT_POLL_MS = 2500;

function defaultOnSigint(handler: () => void): () => void {
  process.on('SIGINT', handler);
  return () => {
    process.removeListener('SIGINT', handler);
  };
}

function resolveLocalServerUrl(repoDir: string, override?: string): string {
  if (override !== undefined && override.trim() !== '') {
    return normalizeServerUrl(override);
  }
  const configPath = join(repoDir, '.plandesk', 'config.json');
  if (!existsSync(configPath)) {
    throw new Error('Missing .plandesk/config.json');
  }
  const config = parseConfigJson(readFileSync(configPath, 'utf8'));
  return normalizeServerUrl(config.serverUrl);
}

function projectIdFromPollUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter((p) => p.length > 0);
    // .../api/v1/projects/:id
    const idx = parts.lastIndexOf('projects');
    const segment = idx >= 0 ? parts[idx + 1] : undefined;
    if (segment !== undefined) {
      return decodeURIComponent(segment);
    }
  } catch {
    // fall through
  }
  return '';
}

/**
 * Polls project state and yields a change signal each successful poll after the
 * baseline. Replaces the former SSE stream at `/api/v1/events`. watchPush
 * debounces the actual push.
 */
export async function createFetchEventStream(
  url: string,
  signal: AbortSignal,
  pollIntervalMs: number = DEFAULT_POLL_MS,
): Promise<EventStream> {
  let closed = false;
  const projectId = projectIdFromPollUrl(url);
  let baselineTaken = false;

  // Fail fast if the server is unreachable (same as former SSE open).
  try {
    const probe = await fetch(url, { signal });
    if (!probe.ok) {
      throw new LocalServerUnreachableError();
    }
    await probe.json();
    baselineTaken = true;
  } catch (err) {
    if (err instanceof LocalServerUnreachableError) {
      throw err;
    }
    if (signal.aborted) {
      // fall through to empty stream
    } else {
      throw new LocalServerUnreachableError();
    }
  }

  const stream: EventStream = {
    async *[Symbol.asyncIterator]() {
      while (!closed && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollIntervalMs);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          if (signal.aborted) {
            clearTimeout(timer);
            resolve();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        });

        if (closed || signal.aborted) {
          return;
        }

        let response: Response;
        try {
          response = await fetch(url, { signal });
        } catch {
          if (signal.aborted || closed) {
            return;
          }
          throw new LocalServerUnreachableError();
        }

        if (!response.ok) {
          if (signal.aborted || closed) {
            return;
          }
          throw new LocalServerUnreachableError();
        }

        await response.json();

        if (baselineTaken) {
          yield { projectId };
        } else {
          baselineTaken = true;
        }
      }
    },
    close() {
      closed = true;
    },
  };

  return stream;
}

export async function runWatch(
  db: Db,
  options: WatchOptions,
  partialDeps?: Partial<WatchRunnerDeps>,
): Promise<void> {
  const resolved = resolveSyncRemote(options);
  const localServerUrl = resolveLocalServerUrl(options.repoDir, options.localServerUrl);
  const org = await ensureDefaultOrg(db);
  const defaultSyncService = createServices({ db, orgId: org.id }).syncService;
  const pollIntervalMs = partialDeps?.pollIntervalMs ?? DEFAULT_POLL_MS;

  const deps: WatchRunnerDeps = {
    createEventStream: (url, signal) => createFetchEventStream(url, signal, pollIntervalMs),
    syncService: defaultSyncService,
    onSigint: defaultOnSigint,
    writeStdout: (text) => {
      process.stdout.write(text);
    },
    writeStderr: (text) => {
      process.stderr.write(text);
    },
    ...partialDeps,
  };

  const watcher = deps.syncService.watchPush(resolved.projectId, resolved.syncRemote);
  const abort = new AbortController();

  try {
    await deps.syncService.push(resolved.projectId, resolved.syncRemote);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.writeStderr(`Initial push failed: ${message}\n`);
  }

  deps.writeStdout(
    `Watching ${resolved.projectId} → pushing to ${resolved.syncRemote.serverUrl} on change (Ctrl-C to stop).\n`,
  );

  const stream = await deps.createEventStream(
    `${localServerUrl}/api/v1/projects/${encodeURIComponent(resolved.projectId)}`,
    abort.signal,
  );
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    abort.abort();
    watcher.dispose();
    stream.close();
  };

  const consumeStream = async (): Promise<void> => {
    for await (const event of stream) {
      if (event.projectId === resolved.projectId || event.projectId === '') {
        watcher.onChange();
      }
    }
    if (!abort.signal.aborted) {
      throw new WatchDisconnectedError();
    }
  };

  const waitForSigint = new Promise<void>((resolve) => {
    const remove = deps.onSigint(() => {
      remove();
      resolve();
    });
  });

  try {
    await Promise.race([consumeStream(), waitForSigint]);
  } finally {
    cleanup();
  }
}
