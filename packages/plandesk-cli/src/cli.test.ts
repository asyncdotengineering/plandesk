import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crashCourse,
  DEFAULT_BIND_HOST,
  DEFAULT_PORT,
  findLocalPlandeskDir,
  isLoopbackHost,
  parseArgs,
  resolveAuthPassword,
  resolveBindHost,
  resolveBoard,
  resolveDataDir,
  workspaceDbPath,
} from './args.js';
import { ONBOARD_GUIDE, printOnboard } from './onboard.js';
import { main } from './cli.js';
import { runInit } from './init.js';
import { readServerInfo, readWorkspaceJson, writeWorkspaceJson } from './connect-artifacts.js';
import {
  createListenErrorHandler,
  resolveServeRuntime,
  startServer,
  validateServeBind,
} from './serve.js';
import { resolveServerConfig, SERVER_CONFIG_FILENAME } from './config.js';
import { DEFAULT_ORG_ID, createDb, migrate } from '@plandesk/db';

describe('parseArgs', () => {
  it('parses init with data-dir override', async () => {
    expect(parseArgs(['node', 'plandesk', 'init', '--data-dir', '/tmp/ws'])).toEqual({
      command: 'init',
      dataDir: '/tmp/ws',
      localDb: false,
    });
  });

  it('parses init --local-db', async () => {
    expect(parseArgs(['node', 'plandesk', 'init', '--local-db'])).toEqual({
      command: 'init',
      dataDir: undefined,
      localDb: true,
    });
  });

  it('parses serve with default port (no flag → undefined, resolved from workspace.json in cli.ts)', async () => {
    expect(parseArgs(['node', 'plandesk', 'serve'])).toEqual({
      command: 'serve',
      port: undefined,
      strictPort: false,
    });
  });

  it('parses serve with --strict-port', async () => {
    expect(parseArgs(['node', 'plandesk', 'serve', '--strict-port'])).toEqual({
      command: 'serve',
      port: undefined,
      strictPort: true,
    });
  });

  it('parses url command', async () => {
    expect(parseArgs(['node', 'plandesk', 'url'])).toEqual({
      command: 'url',
      repoDir: undefined,
      lan: false,
    });
    expect(parseArgs(['node', 'plandesk', 'url', '--lan'])).toEqual({
      command: 'url',
      repoDir: undefined,
      lan: true,
    });
    expect(parseArgs(['node', 'plandesk', 'url', '--repo', '/tmp/repo'])).toEqual({
      command: 'url',
      repoDir: '/tmp/repo',
      lan: false,
    });
  });

  it('parses serve with port, host, and data-dir', async () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'serve',
        '--port',
        '4000',
        '--host',
        '0.0.0.0',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'serve',
      port: 4000,
      host: '0.0.0.0',
      dataDir: '/tmp/ws',
      strictPort: false,
    });
  });

  it('returns help (crash course) for empty argv', async () => {
    expect(parseArgs(['node', 'plandesk'])).toEqual({ command: 'help', full: false });
  });

  it('returns full help with --commands', async () => {
    expect(parseArgs(['node', 'plandesk', 'help', '--commands'])).toEqual({
      command: 'help',
      full: true,
    });
  });

  it('parses version as command and flag', async () => {
    expect(parseArgs(['node', 'plandesk', 'version'])).toEqual({ command: 'version' });
    expect(parseArgs(['node', 'plandesk', '--version'])).toEqual({ command: 'version' });
  });

  it('parses onboard as a command', async () => {
    expect(parseArgs(['node', 'plandesk', 'onboard'])).toEqual({ command: 'onboard' });
  });

  it('parses migrate with --db and --db-token', () => {
    expect(
      parseArgs(['node', 'plandesk', 'migrate', '--db', 'libsql://x', '--db-token', 'tok']),
    ).toEqual({
      command: 'migrate',
      dbUrl: 'libsql://x',
      dbToken: 'tok',
      dataDir: undefined,
      configPath: undefined,
    });
  });

  it('parses serve with --config', () => {
    expect(
      parseArgs(['node', 'plandesk', 'serve', '--config', '/tmp/plandesk.server.json']),
    ).toEqual({
      command: 'serve',
      port: undefined,
      strictPort: false,
      configPath: '/tmp/plandesk.server.json',
    });
  });
});

describe('resolveServeRuntime (config file alone, env overrides — REQ-1/REQ-2)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    delete process.env.PLANDESK_HOST;
    delete process.env.PLANDESK_PORT;
  });

  it('boots host/port from a config file alone (no env)', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-cfg-'));
    tempDirs.push(dataDir);
    writeFileSync(
      join(dataDir, SERVER_CONFIG_FILENAME),
      JSON.stringify({ host: '0.0.0.0', port: 3939 }),
    );
    const runtime = resolveServeRuntime({
      port: undefined,
      dataDir,
      host: undefined,
      strictPort: false,
      configPath: undefined,
    });
    expect(runtime.host).toBe('0.0.0.0');
    expect(runtime.port).toBe(3939);
  });

  it('env host/port override the config file', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-env-'));
    tempDirs.push(dataDir);
    writeFileSync(
      join(dataDir, SERVER_CONFIG_FILENAME),
      JSON.stringify({ host: '0.0.0.0', port: 3939 }),
    );
    process.env.PLANDESK_HOST = '1.1.1.1';
    process.env.PLANDESK_PORT = '7000';
    const runtime = resolveServeRuntime({
      port: undefined,
      dataDir,
      host: undefined,
      strictPort: false,
      configPath: undefined,
    });
    expect(runtime.host).toBe('1.1.1.1');
    expect(runtime.port).toBe(7000);
  });

  it('flag overrides env and file', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-flag-'));
    tempDirs.push(dataDir);
    writeFileSync(
      join(dataDir, SERVER_CONFIG_FILENAME),
      JSON.stringify({ host: '0.0.0.0', port: 3939 }),
    );
    process.env.PLANDESK_HOST = '1.1.1.1';
    const runtime = resolveServeRuntime({
      port: 1234,
      dataDir,
      host: '9.9.9.9',
      strictPort: false,
      configPath: undefined,
    });
    expect(runtime.host).toBe('9.9.9.9');
    expect(runtime.port).toBe(1234);
  });

  it('a malformed config file surfaces a clear error', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-bad-'));
    tempDirs.push(dataDir);
    writeFileSync(join(dataDir, SERVER_CONFIG_FILENAME), '{ broken');
    expect(() =>
      resolveServeRuntime({ port: undefined, dataDir, host: undefined, strictPort: false }),
    ).toThrow(/invalid JSON/);
  });
});

describe('crashCourse', () => {
  it('orients both humans and agents with real doc links', async () => {
    const out = crashCourse();
    expect(out).toContain('https://plandesk.asyncdot.com/start.md');
    expect(out).toContain('READ THESE');
    expect(out).toContain('plandesk connect');
    expect(out).toContain('Agents:'); // explicit instruction to fetch the links
    expect(out).toContain('plandesk help --commands');
    expect(out).toContain('plandesk onboard');
  });
});

describe('repo gitignore (BA0b)', () => {
  it('ignores workspace.db and .pre-* migration backups (no un-ignore negation)', async () => {
    // packages/plandesk-cli/src → repo root is three levels up
    const rootGitignore = readFileSync(join(process.cwd(), '../../.gitignore'), 'utf8');
    expect(rootGitignore).toMatch(/^\*\.db$/m);
    expect(rootGitignore).toMatch(/^\.plandesk\/\*\.pre-\*$/m);
    expect(rootGitignore).not.toContain('!.plandesk/workspace.db');
  });
});

describe('onboard guide', () => {
  it('teaches the model without assuming any worker CLI or delegation skill exists', async () => {
    const out = ONBOARD_GUIDE;
    // Portability invariant: the guide must tell the agent to self-execute when
    // no worker is installed — never assume a delegate skill or worker CLI ships
    // on the machine reading it.
    expect(out).toContain('do the work yourself');
    expect(out).toContain('get_next_task');
    expect(out).toContain('Factory');
    // References only Plan-Desk-shipped surfaces, not a personal ~/.agents setup.
    expect(out).not.toContain('~/.agents');
    expect(out).not.toContain('/delegate');
  });

  it('does not claim the board is committed or travels with the code', async () => {
    const out = ONBOARD_GUIDE;
    expect(out).not.toMatch(/travels with the code/i);
    expect(out).not.toMatch(/committed so the plan/i);
    expect(out).toContain('not** committed');
    expect(out).toContain('plandesk export');
  });

  it('printOnboard writes the guide to the provided sink', async () => {
    let captured = '';
    printOnboard((s) => {
      captured += s;
    });
    expect(captured).toContain('Plan Desk — onboarding for agents');
  });
});

describe('bind host', () => {
  it('defaults serve bind host to loopback (LAN is opt-in)', async () => {
    expect(DEFAULT_BIND_HOST).toBe('127.0.0.1');
    expect(resolveBindHost()).toBe('127.0.0.1');
  });

  it('honors --host over PLANDESK_HOST', async () => {
    vi.stubEnv('PLANDESK_HOST', '192.168.1.5');
    expect(resolveBindHost('0.0.0.0')).toBe('0.0.0.0');
    vi.unstubAllEnvs();
  });

  it('reads PLANDESK_HOST when --host is absent', async () => {
    vi.stubEnv('PLANDESK_HOST', '0.0.0.0');
    expect(resolveBindHost()).toBe('0.0.0.0');
    vi.unstubAllEnvs();
  });

  it('classifies loopback hosts', async () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });
});

describe('validateServeBind', () => {
  it('allows non-loopback bind without a password (open LAN access)', async () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', '');
    expect(validateServeBind({ port: 7526, host: '0.0.0.0' })).toEqual({
      host: '0.0.0.0',
      authPassword: undefined,
    });
    vi.unstubAllEnvs();
  });

  it('passes authPassword when PLANDESK_AUTH_PASSWORD is set', async () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', 'secret');
    expect(validateServeBind({ port: 7526, host: '0.0.0.0' })).toEqual({
      host: '0.0.0.0',
      authPassword: 'secret',
    });
    vi.unstubAllEnvs();
  });
});

describe('resolveAuthPassword', () => {
  it('returns undefined when unset', async () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', '');
    expect(resolveAuthPassword()).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('reads PLANDESK_AUTH_PASSWORD', async () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', 'secret');
    expect(resolveAuthPassword()).toBe('secret');
    vi.unstubAllEnvs();
  });
});

describe('runInit', () => {
  it('creates a migrated workspace.db and records the fixed default port in workspace.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-'));
    try {
      const dbPath = await runInit(dataDir);
      expect(dbPath).toBe(workspaceDbPath(dataDir));
      const ws = readWorkspaceJson(dataDir);
      expect(ws).toBeDefined();
      expect(ws?.port).toBe(DEFAULT_PORT);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('is idempotent: second init preserves the assigned port', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-idem-'));
    try {
      await runInit(dataDir);
      writeWorkspaceJson(dataDir, 3999);
      await runInit(dataDir);
      expect(readWorkspaceJson(dataDir)?.port).toBe(3999);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('creates Better Auth tables, a user-less local org, and a gitignored stable secret', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-auth-'));
    try {
      const dbPath = await runInit(dataDir);
      const firstSecret = readFileSync(join(dataDir, 'better-auth-secret'), 'utf8').trim();
      expect(firstSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(readFileSync(join(dataDir, '.gitignore'), 'utf8').split('\n')).toContain(
        'better-auth-secret',
      );

      await runInit(dataDir);
      expect(readFileSync(join(dataDir, 'better-auth-secret'), 'utf8').trim()).toBe(firstSecret);

      const db = await createDb(dbPath);
      const tables = await db.$client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization', 'user', 'account', 'member')",
      );
      expect(new Set(tables.rows.map((row) => row.name))).toEqual(
        new Set(['account', 'member', 'organization', 'user']),
      );
      const localOrg = await db.$client.execute(
        "SELECT id, slug FROM organization WHERE id = '00000000-0000-4000-8000-0000000000a1'",
      );
      expect(localOrg.rows).toHaveLength(1);
      expect(localOrg.rows[0]?.slug).toBe('local');
      const identities = await db.$client.execute('SELECT COUNT(*) AS count FROM user');
      const members = await db.$client.execute('SELECT COUNT(*) AS count FROM member');
      expect(Number(identities.rows[0]?.count)).toBe(0);
      expect(Number(members.rows[0]?.count)).toBe(0);
      db.$client.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('default init targets the global data dir; --local-db creates repo-local', async () => {
    const cwd = process.cwd();
    const tmpRepo = mkdtempSync(join(tmpdir(), 'plandesk-init-local-'));
    const prevDataDir = process.env.PLANDESK_DATA_DIR;
    try {
      process.chdir(tmpRepo);
      // macOS may resolve /tmp → /private/tmp after chdir; use real cwd.
      const repoCwd = process.cwd();
      delete process.env.PLANDESK_DATA_DIR;

      // Global default (no override, no localDb, no shadow yet) — not repo-local
      expect(resolveBoard({ localDb: false }).dataDir).not.toBe(join(repoCwd, '.plandesk'));
      expect(resolveBoard({ localDb: false }).dataDir).toMatch(/\.plandesk$/);
      expect(resolveBoard({ localDb: false }).source).toBe('default');
      // --local-db opt-in
      expect(resolveBoard({ localDb: true }).dataDir).toBe(join(repoCwd, '.plandesk'));
      expect(resolveBoard({ localDb: true }).source).toBe('flag');

      const localDbPath = await runInit(undefined, { localDb: true });
      expect(localDbPath).toBe(join(repoCwd, '.plandesk', 'workspace.db'));
      expect(resolveDataDir(undefined, repoCwd)).toBe(join(repoCwd, '.plandesk'));
    } finally {
      process.chdir(cwd);
      if (prevDataDir === undefined) {
        delete process.env.PLANDESK_DATA_DIR;
      } else {
        process.env.PLANDESK_DATA_DIR = prevDataDir;
      }
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it('init is shadow-aware: once a repo-local board exists, plain init (no flags) agrees with serve/doctor (#34)', async () => {
    const cwd = process.cwd();
    const tmpRepo = mkdtempSync(join(tmpdir(), 'plandesk-init-shadow-'));
    const prevDataDir = process.env.PLANDESK_DATA_DIR;
    try {
      process.chdir(tmpRepo);
      const repoCwd = process.cwd();
      delete process.env.PLANDESK_DATA_DIR;

      // Someone previously opted into a repo-local board.
      await runInit(undefined, { localDb: true });

      // Plain `init` (no --local-db, no --data-dir) must now resolve to that
      // SAME shadow board, not silently fall back to the global one.
      const initResolution = resolveBoard({});
      expect(initResolution.dataDir).toBe(join(repoCwd, '.plandesk'));
      expect(initResolution.source).toBe('shadow');

      // serve/doctor already walked up for a shadow board — must resolve identically.
      const serveResolution = resolveBoard({});
      expect(serveResolution).toEqual(initResolution);
    } finally {
      process.chdir(cwd);
      if (prevDataDir === undefined) {
        delete process.env.PLANDESK_DATA_DIR;
      } else {
        process.env.PLANDESK_DATA_DIR = prevDataDir;
      }
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it('`plandesk init` prints the resolved board before acting (REQ-A1b)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-print-'));
    try {
      const stdoutChunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          stdoutChunks.push(String(chunk));
          return true;
        });
      let code = 1;
      try {
        code = await main(['node', 'plandesk', 'init', '--data-dir', dataDir]);
      } finally {
        stdoutSpy.mockRestore();
      }
      expect(code).toBe(0);
      expect(stdoutChunks.join('')).toContain(`board: ${dataDir} (flag)`);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('createListenErrorHandler', () => {
  it('reports port-in-use and exits with code 1', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let exitCode = 0;
    const exit = ((code: number) => {
      exitCode = code;
      throw new Error('exit');
    }) as (code: number) => never;

    // Nothing listens on this port, so the owner-identity fetch fails fast
    // and falls back to the generic message (REQ-A3c covered separately below).
    const handler = createListenErrorHandler(7526, exit);
    await expect(
      handler(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })),
    ).rejects.toThrow('exit');

    expect(exitCode).toBe(1);
    expect(stderr.mock.calls.flat().join('')).toContain('already in use');
    stderr.mockRestore();
  });

  it('names the other board that owns the port when it is reachable (REQ-A3c)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-eaddrinuse-owner-'));
    const servers: Array<{ close: (cb?: (err?: Error) => void) => void }> = [];
    try {
      await runInit(dataDir);
      const owner = await startServer({ port: 0, dataDir });
      servers.push(owner);
      if (!owner.listening) {
        await new Promise<void>((resolve) => owner.once('listening', resolve));
      }
      const address = owner.address();
      const ownerPort = typeof address === 'object' && address !== null ? address.port : 0;

      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let exitCode = 0;
      const exit = ((code: number) => {
        exitCode = code;
        throw new Error('exit');
      }) as (code: number) => never;

      const handler = createListenErrorHandler(ownerPort, exit);
      await expect(
        handler(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })),
      ).rejects.toThrow('exit');

      expect(exitCode).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain(`board: ${dataDir}`);
      stderr.mockRestore();
    } finally {
      for (const server of servers.splice(0)) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('startServer', () => {
  const servers: Array<{ close: (cb?: (err?: Error) => void) => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('responds to health on loopback and writes server.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-'));
    await runInit(dataDir);
    const port = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, DEFAULT_BIND_HOST, () => {
        const address = probe.address();
        if (address !== null && typeof address !== 'object') {
          throw new Error('expected TCP address');
        }
        resolve(address?.port ?? 0);
        probe.close();
      });
      servers.push(probe);
    });

    const server = await startServer({ port, dataDir });
    servers.push(server);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dataDir });

    const info = readServerInfo(dataDir);
    expect(info?.port).toBe(port);
    expect(info?.pid).toBe(process.pid);
    expect(info?.dataDir).toBe(dataDir);

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    servers.splice(servers.indexOf(server), 1);
    expect(readServerInfo(dataDir)).toBeUndefined();

    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates Better Auth tables during serve boot, not only through direct migrator calls', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-auth-'));
    const db = await createDb(workspaceDbPath(dataDir));
    await migrate(db);
        const before = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='organization'",
    );
    expect(before.rows).toHaveLength(0);

    const server = await startServer({ port: 0, dataDir });
    servers.push(server);
    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', resolve));
    }

    const after = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization', 'user', 'account')",
    );
    expect(new Set(after.rows.map((row) => row.name))).toEqual(
      new Set(['account', 'organization', 'user']),
    );

    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    servers.splice(servers.indexOf(server), 1);
    db.$client.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('fails before listening when a remote database has not been migrated', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-remote-'));
    const remoteDb = join(dataDir, 'remote.db');
    writeFileSync(
      join(dataDir, SERVER_CONFIG_FILENAME),
      JSON.stringify({ dbUrl: remoteDb }),
      'utf8',
    );

    await expect(startServer({ port: 0, dataDir })).rejects.toThrow(
      `Run \`plandesk migrate --db ${remoteDb}\` first.`,
    );
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function blockedPort(): Promise<number> {
    return new Promise<number>((resolve) => {
      const blocker = createServer();
      blocker.listen(0, DEFAULT_BIND_HOST, () => {
        const address = blocker.address();
        if (address !== null && typeof address !== 'object') {
          throw new Error('expected TCP address');
        }
        resolve(address?.port ?? 0);
      });
      servers.push(blocker);
    });
  }

  it('exits 1 when the requested port is already in use (no rotation)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-busy-'));
    await runInit(dataDir);
    const port = await blockedPort();

    let exitCode = 0;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = ((code: number) => {
      exitCode = code;
    }) as (code: number) => never;

    await startServer({ port, dataDir }, exit);

    // The blocked port is a raw TCP listener, not an HTTP server — the
    // owner-identity fetch (REQ-A3c) times out (bounded at 1.5s) before the
    // handler falls back to the generic message and exits.
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(exitCode).toBe(1);
    expect(stderr.mock.calls.flat().join('')).toContain('already in use');
    stderr.mockRestore();

    rmSync(dataDir, { recursive: true, force: true });
  }, 10000);
});

describe('resolveDataDir', () => {
  it('uses override when provided', async () => {
    expect(resolveDataDir('/tmp/custom')).toBe('/tmp/custom');
  });

  it('reads PLANDESK_DATA_DIR when override is absent', async () => {
    vi.stubEnv('PLANDESK_DATA_DIR', '/data');
    expect(resolveDataDir()).toBe('/data');
    vi.unstubAllEnvs();
  });

  it('finds local workspace only when workspace.db exists (not connect-only .plandesk/)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-resolve-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    mkdirSync(plandeskDir);
    try {
      // Connect-only: .plandesk/ without workspace.db → fall through to global
      expect(resolveDataDir(undefined, tmpDir)).not.toBe(plandeskDir);

      // Explicitly created local db
      writeFileSync(join(plandeskDir, 'workspace.db'), '');
      expect(resolveDataDir(undefined, tmpDir)).toBe(plandeskDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('findLocalPlandeskDir', () => {
  it('returns undefined when no .plandesk/ exists in the tree', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-find-'));
    try {
      expect(findLocalPlandeskDir(tmpDir)).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds .plandesk/ in the given directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-find-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    mkdirSync(plandeskDir);
    try {
      expect(findLocalPlandeskDir(tmpDir)).toBe(plandeskDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds .plandesk/ in a parent directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-find-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    const child = join(tmpDir, 'sub', 'deep');
    mkdirSync(plandeskDir);
    mkdirSync(child, { recursive: true });
    try {
      expect(findLocalPlandeskDir(child)).toBe(plandeskDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('resolveBoard', () => {
  it('uses override when provided (source: flag)', async () => {
    expect(resolveBoard({ override: '/tmp/custom' })).toEqual({
      dataDir: '/tmp/custom',
      source: 'flag',
    });
  });

  it('reads PLANDESK_DATA_DIR when override is absent (source: env)', async () => {
    vi.stubEnv('PLANDESK_DATA_DIR', '/data');
    expect(resolveBoard({})).toEqual({ dataDir: '/data', source: 'env' });
    vi.unstubAllEnvs();
  });

  it('defaults to the global ~/.plandesk board when no shadow exists (source: default)', async () => {
    const prev = process.env.PLANDESK_DATA_DIR;
    delete process.env.PLANDESK_DATA_DIR;
    // Use an isolated startDir — the dev machine's real directory tree may
    // itself sit under a repo-local shadow board, which would otherwise leak
    // into this "no shadow" assertion.
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-resolve-default-'));
    try {
      const result = resolveBoard({ startDir: tmpDir });
      expect(result.dataDir).not.toBe(join(tmpDir, '.plandesk'));
      expect(result.dataDir.endsWith('.plandesk')).toBe(true);
      expect(result.source).toBe('default');
    } finally {
      if (prev === undefined) {
        delete process.env.PLANDESK_DATA_DIR;
      } else {
        process.env.PLANDESK_DATA_DIR = prev;
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('with localDb=true targets .plandesk/ in cwd (source: flag)', async () => {
    const prev = process.env.PLANDESK_DATA_DIR;
    delete process.env.PLANDESK_DATA_DIR;
    try {
      expect(resolveBoard({ localDb: true })).toEqual({
        dataDir: join(process.cwd(), '.plandesk'),
        source: 'flag',
      });
    } finally {
      if (prev === undefined) {
        delete process.env.PLANDESK_DATA_DIR;
      } else {
        process.env.PLANDESK_DATA_DIR = prev;
      }
    }
  });

  it('finds a repo-local shadow board over the global default (source: shadow)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-resolve-board-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    mkdirSync(plandeskDir);
    try {
      writeFileSync(join(plandeskDir, 'workspace.db'), '');
      expect(resolveBoard({ startDir: tmpDir })).toEqual({ dataDir: plandeskDir, source: 'shadow' });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('precedence: flag > env > local-db > shadow > default', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-resolve-precedence-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    mkdirSync(plandeskDir);
    writeFileSync(join(plandeskDir, 'workspace.db'), '');
    try {
      vi.stubEnv('PLANDESK_DATA_DIR', '/env-wins-over-shadow');
      // flag beats env even with a shadow board present.
      expect(resolveBoard({ override: '/flag-wins', startDir: tmpDir }).dataDir).toBe('/flag-wins');
      // env beats shadow.
      expect(resolveBoard({ startDir: tmpDir }).dataDir).toBe('/env-wins-over-shadow');
      vi.unstubAllEnvs();
      // local-db beats shadow once env is out of the way.
      expect(resolveBoard({ localDb: true, startDir: tmpDir }).dataDir).toBe(
        join(tmpDir, '.plandesk'),
      );
      expect(resolveBoard({ localDb: true, startDir: tmpDir }).source).toBe('flag');
      // shadow beats default.
      expect(resolveBoard({ startDir: tmpDir })).toEqual({ dataDir: plandeskDir, source: 'shadow' });
    } finally {
      vi.unstubAllEnvs();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
