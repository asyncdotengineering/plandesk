import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { getRequestListener } from '@hono/node-server';
import { join } from 'node:path';
import { createServices } from '@plandesk/api';
import { createProject } from '@plandesk/db';
import {
  createSyncDb,
  createSyncServer,
  createSyncToken,
  migrate as migrateSyncServer,
} from '@plandesk/sync-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from './args.js';
import { buildConfigJson } from './connect-artifacts.js';
import { main } from './cli.js';
import { runInit } from './init.js';
import { openWorkspace } from './workspace.js';

async function captureIo(
  run: () => Promise<number> | number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  let code = 1;
  try {
    code = await Promise.resolve(run());
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    code,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

async function startTestSyncServer(): Promise<{
  serverUrl: string;
  syncToken: string;
  close: () => void;
}> {
  const syncDb = createSyncDb(':memory:');
  migrateSyncServer(syncDb);
  const { token: syncToken } = createSyncToken(syncDb, { label: 'cli-test' });
  const app = createSyncServer({ db: syncDb });
  const server: Server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('expected TCP address');
  }

  return {
    serverUrl: `http://127.0.0.1:${String(address.port)}`,
    syncToken,
    close: () => {
      server.close();
    },
  };
}

describe('parseArgs publish/push/pull', () => {
  it('parses publish with remote, project, sync-token, and repo', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'publish',
        '--remote',
        'https://sync.example',
        '--project',
        'proj-1',
        '--sync-token',
        'secret',
        '--repo',
        '/tmp/repo',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'publish',
      remoteUrl: 'https://sync.example',
      projectId: 'proj-1',
      syncToken: 'secret',
      repoDir: '/tmp/repo',
      dataDir: '/tmp/ws',
    });
  });

  it('returns unknown when publish is missing --remote', () => {
    expect(parseArgs(['node', 'plandesk', 'publish', '--project', 'proj-1'])).toEqual({
      command: 'unknown',
      name: 'publish (missing --remote)',
    });
  });

  it('parses sync --watch with project and repo', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'sync',
        '--watch',
        '--project',
        'proj-1',
        '--repo',
        '/tmp/repo',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'sync',
      watch: true,
      projectId: 'proj-1',
      repoDir: '/tmp/repo',
      dataDir: '/tmp/ws',
    });
  });

  it('parses push and pull with project and repo', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'push',
        '--project',
        'proj-1',
        '--repo',
        '/tmp/repo',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'push',
      projectId: 'proj-1',
      repoDir: '/tmp/repo',
      dataDir: '/tmp/ws',
    });
    expect(
      parseArgs(['node', 'plandesk', 'pull', '--project', 'proj-1', '--data-dir', '/tmp/ws']),
    ).toEqual({
      command: 'pull',
      projectId: 'proj-1',
      dataDir: '/tmp/ws',
    });
  });
});

describe('CLI publish/push/pull', () => {
  const tempDirs: string[] = [];
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    while (servers.length > 0) {
      servers.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    vi.unstubAllEnvs();
  });

  function makeWorkspace(): { dataDir: string; repoDir: string; projectId: string } {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-sync-cli-ws-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-sync-cli-repo-'));
    tempDirs.push(dataDir, repoDir);
    runInit(dataDir);
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'Sync CLI' });
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({
        serverUrl: 'http://127.0.0.1:3847',
        projectId: project.id,
        projectName: project.name,
      }),
    );
    return { dataDir, repoDir, projectId: project.id };
  }

  it('publish writes sync config and gitignored sync-token', async () => {
    const syncServer = await startTestSyncServer();
    servers.push(syncServer);
    const { dataDir, repoDir, projectId } = makeWorkspace();
    const { db } = openWorkspace(dataDir);
    const { shareService } = createServices({ db });
    shareService.createShare(projectId, { audienceName: 'Client', mode: 'public' });

    const { code, stdout } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'publish',
        '--remote',
        syncServer.serverUrl,
        '--sync-token',
        syncServer.syncToken,
        '--project',
        projectId,
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Published');
    expect(stdout).toContain('pushed 1 share(s)');

    const config = JSON.parse(readFileSync(join(repoDir, '.plandesk', 'config.json'), 'utf8')) as {
      sync?: { serverUrl: string; globalProjectId: string };
    };
    expect(config.sync?.serverUrl).toBe(syncServer.serverUrl);
    expect(config.sync?.globalProjectId).toBeTruthy();
    expect(JSON.stringify(config)).not.toContain(syncServer.syncToken);

    const syncTokenPath = join(repoDir, '.plandesk', 'sync-token');
    expect(existsSync(syncTokenPath)).toBe(true);
    expect(readFileSync(syncTokenPath, 'utf8').trim()).toBe(syncServer.syncToken);

    const gitignore = readFileSync(join(repoDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.plandesk/sync-token');
  });

  it('push resolves config and pushes shares', async () => {
    const syncServer = await startTestSyncServer();
    servers.push(syncServer);
    const { dataDir, repoDir, projectId } = makeWorkspace();
    const { db } = openWorkspace(dataDir);
    const { shareService } = createServices({ db });
    shareService.createShare(projectId, { audienceName: 'Client', mode: 'public' });

    const publish = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'publish',
        '--remote',
        syncServer.serverUrl,
        '--sync-token',
        syncServer.syncToken,
        '--project',
        projectId,
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );
    expect(publish.code).toBe(0);

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'push', '--repo', repoDir, '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Pushed 1 share(s)');
  });

  it('pull resolves config and reports triage count', async () => {
    const syncServer = await startTestSyncServer();
    servers.push(syncServer);
    const { dataDir, repoDir, projectId } = makeWorkspace();

    const publish = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'publish',
        '--remote',
        syncServer.serverUrl,
        '--sync-token',
        syncServer.syncToken,
        '--project',
        projectId,
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );
    expect(publish.code).toBe(0);

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'pull', '--repo', repoDir, '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Pulled 0 submission(s)');
    expect(stdout).toContain('0 pending in triage');
  });
});
