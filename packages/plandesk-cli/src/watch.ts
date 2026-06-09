import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@plandesk/db';
import type { PlankDeskEvent, SyncService } from '@plandesk/api';
import { createServices } from '@plandesk/api';
import { normalizeServerUrl, parseConfigJson } from './connect-artifacts.js';
import { resolveSyncRemote } from './sync.js';

export class LocalServerUnreachableError extends Error {
  constructor() {
    super("Cannot reach local Plan Desk server. Is 'plandesk serve' running?");
    this.name = 'LocalServerUnreachableError';
  }
}

export class SseDisconnectedError extends Error {
  constructor() {
    super('Local Plan Desk server SSE disconnected. Restart plandesk sync --watch.');
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

export type EventStream = {
  [Symbol.asyncIterator](): AsyncIterator<PlankDeskEvent>;
  close(): void;
};

export type WatchRunnerDeps = {
  createEventStream: (url: string, signal: AbortSignal) => Promise<EventStream>;
  syncService: Pick<SyncService, 'push' | 'watchPush'>;
  onSigint: (handler: () => void) => () => void;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
};

function defaultOnSigint(handler: () => void): () => void {
  process.on('SIGINT', handler);
  return () => {
    process.removeListener('SIGINT', handler);
  };
}

function parseSseChunk(chunk: string): PlankDeskEvent[] {
  const events: PlankDeskEvent[] = [];
  for (const part of chunk.split('\n\n')) {
    for (const line of part.split('\n')) {
      if (line.startsWith('data: ')) {
        events.push(JSON.parse(line.slice(6)) as PlankDeskEvent);
      }
    }
  }
  return events;
}

function hasProjectId(event: PlankDeskEvent): event is PlankDeskEvent & { projectId: string } {
  return 'projectId' in event && typeof event.projectId === 'string';
}

export async function createFetchEventStream(
  url: string,
  signal: AbortSignal,
): Promise<EventStream> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch {
    throw new LocalServerUnreachableError();
  }

  if (!response.ok || response.body === null) {
    throw new LocalServerUnreachableError();
  }

  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;

  const stream: EventStream = {
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        const chunk = await reader.read();
        if (chunk.done) {
          if (!signal.aborted) {
            throw new SseDisconnectedError();
          }
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const event of parseSseChunk(part)) {
            yield event;
          }
        }
      }
      if (buffer.length > 0) {
        for (const event of parseSseChunk(buffer)) {
          yield event;
        }
      }
    },
    close() {
      closed = true;
      void reader.cancel();
    },
  };

  return stream;
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

export async function runWatch(
  db: Db,
  options: WatchOptions,
  partialDeps?: Partial<WatchRunnerDeps>,
): Promise<void> {
  const resolved = resolveSyncRemote(options);
  const localServerUrl = resolveLocalServerUrl(options.repoDir, options.localServerUrl);
  const defaultSyncService = createServices({ db }).syncService;

  const deps: WatchRunnerDeps = {
    createEventStream: createFetchEventStream,
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

  const stream = await deps.createEventStream(`${localServerUrl}/api/v1/events`, abort.signal);
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
      if (hasProjectId(event) && event.projectId === resolved.projectId) {
        watcher.onChange();
      }
    }
    if (!abort.signal.aborted) {
      throw new SseDisconnectedError();
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
