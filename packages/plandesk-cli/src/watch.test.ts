import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncService } from '@plandesk/api';
import { createProject } from '@plandesk/db';
import { buildConfigJson } from './connect-artifacts.js';
import { runInit } from './init.js';
import { writeSyncToken } from './sync.js';
import type { EventStream, WatchChangeEvent } from './watch.js';
import { runWatch } from './watch.js';
import { openWorkspace } from './workspace.js';

function makeEventStream(events: WatchChangeEvent[]): EventStream {
  let resolveWait: (() => void) | undefined;
  const waitPromise = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });

  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
        await Promise.resolve();
      }
      await waitPromise;
    },
    close() {
      resolveWait?.();
    },
  };
}

describe('runWatch', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  async function makeWorkspace(): Promise<{
    dataDir: string;
    repoDir: string;
    projectId: string;
    db: Awaited<ReturnType<typeof openWorkspace>>['db'];
  }> {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-watch-ws-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-watch-repo-'));
    tempDirs.push(dataDir, repoDir);
    await runInit(dataDir);
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'Watch test' });
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({
        serverUrl: 'http://127.0.0.1:3847',
        projectId: project.id,
        projectName: project.name,
        sync: {
          serverUrl: 'https://sync.example',
          globalProjectId: 'gid-1',
        },
      }),
    );
    writeSyncToken(repoDir, 'sync-token');
    return { dataDir, repoDir, projectId: project.id, db };
  }

  it('calls watchPush onChange for matching project events only', async () => {
    const { repoDir, projectId, db: workspaceDb } = await makeWorkspace();

    const onChange = vi.fn();
    const dispose = vi.fn();
    const push = vi.fn().mockResolvedValue({ pushed: 1 });
    const watchPush = vi.fn().mockReturnValue({ onChange, dispose });
    const syncService = { push, watchPush } as Pick<SyncService, 'push' | 'watchPush'>;

    let sigintHandler: (() => void) | undefined;
    const events = makeEventStream([
      { projectId },
      { projectId: 'other-project' },
      { projectId },
    ]);

    const run = runWatch(
      workspaceDb,
      { repoDir, projectId },
      {
        syncService,
        createEventStream: vi.fn().mockResolvedValue(events),
        onSigint: (handler) => {
          sigintHandler = handler;
          return () => {
            sigintHandler = undefined;
          };
        },
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
      },
    );

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(watchPush).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-1',
        syncToken: 'sync-token',
      }),
    );

    await vi.waitFor(() => {
      expect(sigintHandler).toBeDefined();
    });
    sigintHandler?.();
    await run;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes on SIGINT without leaking the watcher', async () => {
    const { repoDir, projectId, db: workspaceDb } = await makeWorkspace();

    const onChange = vi.fn();
    const dispose = vi.fn();
    const push = vi.fn().mockResolvedValue({ pushed: 0 });
    const watchPush = vi.fn().mockReturnValue({ onChange, dispose });
    const syncService = { push, watchPush } as Pick<SyncService, 'push' | 'watchPush'>;

    let sigintHandler: (() => void) | undefined;
    const events = makeEventStream([]);

    const run = runWatch(
      workspaceDb,
      { repoDir, projectId },
      {
        syncService,
        createEventStream: vi.fn().mockResolvedValue(events),
        onSigint: (handler) => {
          sigintHandler = handler;
          return () => {
            sigintHandler = undefined;
          };
        },
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
      },
    );

    await vi.waitFor(() => {
      expect(sigintHandler).toBeDefined();
    });
    sigintHandler?.();
    await run;
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
