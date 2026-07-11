import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crashCourse,
  DEFAULT_BIND_HOST,
  findLocalPlandeskDir,
  isLoopbackHost,
  parseArgs,
  resolveAuthPassword,
  resolveBindHost,
  resolveDataDir,
  resolveInitDataDir,
  workspaceDbPath,
} from './args.js';
import { assignPort, runInit } from './init.js';
import {
  isPortOwnedByAnotherProject,
  readPortRegistry,
  readServerInfo,
  readWorkspaceJson,
  writeWorkspaceJson,
} from './connect-artifacts.js';
import { createListenErrorHandler, startServer, validateServeBind } from './serve.js';

// Isolate the machine-global port registry (~/.plandesk/ports.json) so tests
// that run `init`/`serve` never read or write the real one on this machine.
let portRegistryStateDir: string | undefined;
beforeEach(() => {
  portRegistryStateDir = mkdtempSync(join(tmpdir(), 'plandesk-state-'));
  process.env.PLANDESK_STATE_DIR = portRegistryStateDir;
});
afterEach(() => {
  delete process.env.PLANDESK_STATE_DIR;
  if (portRegistryStateDir !== undefined) {
    rmSync(portRegistryStateDir, { recursive: true, force: true });
    portRegistryStateDir = undefined;
  }
});

describe('parseArgs', () => {
  it('parses init with data-dir override', () => {
    expect(parseArgs(['node', 'plandesk', 'init', '--data-dir', '/tmp/ws'])).toEqual({
      command: 'init',
      dataDir: '/tmp/ws',
    });
  });

  it('parses serve with default port (no flag → undefined, resolved from workspace.json in cli.ts)', () => {
    expect(parseArgs(['node', 'plandesk', 'serve'])).toEqual({
      command: 'serve',
      port: undefined,
      strictPort: false,
    });
  });

  it('parses serve with --strict-port', () => {
    expect(parseArgs(['node', 'plandesk', 'serve', '--strict-port'])).toEqual({
      command: 'serve',
      port: undefined,
      strictPort: true,
    });
  });

  it('parses url command', () => {
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

  it('parses serve with port, host, and data-dir', () => {
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

  it('returns help (crash course) for empty argv', () => {
    expect(parseArgs(['node', 'plandesk'])).toEqual({ command: 'help', full: false });
  });

  it('returns full help with --commands', () => {
    expect(parseArgs(['node', 'plandesk', 'help', '--commands'])).toEqual({
      command: 'help',
      full: true,
    });
  });

  it('parses version as command and flag', () => {
    expect(parseArgs(['node', 'plandesk', 'version'])).toEqual({ command: 'version' });
    expect(parseArgs(['node', 'plandesk', '--version'])).toEqual({ command: 'version' });
  });
});

describe('crashCourse', () => {
  it('orients both humans and agents with real doc links', () => {
    const out = crashCourse();
    expect(out).toContain('https://plandesk.asyncdot.com/start.md');
    expect(out).toContain('READ THESE');
    expect(out).toContain('plandesk connect');
    expect(out).toContain('Agents:'); // explicit instruction to fetch the links
    expect(out).toContain('plandesk help --commands');
  });
});

describe('bind host', () => {
  it('defaults serve bind host to loopback (LAN is opt-in)', () => {
    expect(DEFAULT_BIND_HOST).toBe('127.0.0.1');
    expect(resolveBindHost()).toBe('127.0.0.1');
  });

  it('honors --host over PLANDESK_HOST', () => {
    vi.stubEnv('PLANDESK_HOST', '192.168.1.5');
    expect(resolveBindHost('0.0.0.0')).toBe('0.0.0.0');
    vi.unstubAllEnvs();
  });

  it('reads PLANDESK_HOST when --host is absent', () => {
    vi.stubEnv('PLANDESK_HOST', '0.0.0.0');
    expect(resolveBindHost()).toBe('0.0.0.0');
    vi.unstubAllEnvs();
  });

  it('classifies loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });
});

describe('validateServeBind', () => {
  it('allows non-loopback bind without a password (open LAN access)', () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', '');
    expect(validateServeBind({ port: 3847, host: '0.0.0.0' })).toEqual({
      host: '0.0.0.0',
      authPassword: undefined,
    });
    vi.unstubAllEnvs();
  });

  it('passes authPassword when PLANDESK_AUTH_PASSWORD is set', () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', 'secret');
    expect(validateServeBind({ port: 3847, host: '0.0.0.0' })).toEqual({
      host: '0.0.0.0',
      authPassword: 'secret',
    });
    vi.unstubAllEnvs();
  });
});

describe('resolveAuthPassword', () => {
  it('returns undefined when unset', () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', '');
    expect(resolveAuthPassword()).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('reads PLANDESK_AUTH_PASSWORD', () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', 'secret');
    expect(resolveAuthPassword()).toBe('secret');
    vi.unstubAllEnvs();
  });
});

describe('runInit', () => {
  it('creates a migrated workspace.db and assigns a port in workspace.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-'));
    try {
      const dbPath = await runInit(dataDir);
      expect(dbPath).toBe(workspaceDbPath(dataDir));
      const ws = readWorkspaceJson(dataDir);
      expect(ws).toBeDefined();
      expect(ws?.port).toBeGreaterThanOrEqual(3400);
      expect(ws?.port).toBeLessThanOrEqual(3499);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('is idempotent: second init preserves the assigned port', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-idem-'));
    try {
      await runInit(dataDir);
      const firstPort = readWorkspaceJson(dataDir)?.port;
      await runInit(dataDir);
      expect(readWorkspaceJson(dataDir)?.port).toBe(firstPort);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('assigns distinct ports to two different projects even when neither server is listening', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'plandesk-init-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'plandesk-init-b-'));
    try {
      await runInit(dirA);
      await runInit(dirB);
      const portA = readWorkspaceJson(dirA)?.port;
      const portB = readWorkspaceJson(dirB)?.port;
      expect(portA).toBeDefined();
      expect(portB).toBeDefined();
      // The core invariant: no cross-project collision. Before the registry both
      // projects took the same lowest free port because nothing was listening.
      expect(portB).not.toBe(portA);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('reclaims a port whose owning project directory no longer exists', async () => {
    // Assignment is random by default, so pin the rng to always pick the
    // lowest eligible candidate — this isolates the invariant under test
    // (a stale entry stops excluding its port) from the random selection.
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const dirA = mkdtempSync(join(tmpdir(), 'plandesk-init-stale-a-'));
      await runInit(dirA);
      const portA = readWorkspaceJson(dirA)?.port;
      rmSync(dirA, { recursive: true, force: true }); // A is gone → its registry entry is stale

      const dirB = mkdtempSync(join(tmpdir(), 'plandesk-init-stale-b-'));
      try {
        await runInit(dirB);
        // With A's dir gone, its port is reclaimable, so B takes it back rather
        // than being pushed to a higher port by a dead assignment.
        expect(readWorkspaceJson(dirB)?.port).toBe(portA);
      } finally {
        rmSync(dirB, { recursive: true, force: true });
      }
    } finally {
      rng.mockRestore();
    }
  });
});

describe('assignPort rng injection', () => {
  it('returns the eligible candidate at the rng-selected index, not always the lowest', async () => {
    const dataDir = join(tmpdir(), 'plandesk-rng-test-a');
    const lowest = await assignPort(dataDir, () => 0);
    const highest = await assignPort(dataDir, () => 0.999999);
    expect(lowest).toBeGreaterThanOrEqual(3400);
    expect(lowest).toBeLessThanOrEqual(3499);
    expect(highest).toBeGreaterThanOrEqual(3400);
    expect(highest).toBeLessThanOrEqual(3499);
    expect(highest).not.toBe(lowest);
  });

  it('gives two different rng values two different in-range ports when both are free/unowned', async () => {
    const dataDir = join(tmpdir(), 'plandesk-rng-test-b');
    const portA = await assignPort(dataDir, () => 0.1);
    const portB = await assignPort(dataDir, () => 0.9);
    expect(portA).not.toBe(portB);
    expect(portA).toBeGreaterThanOrEqual(3400);
    expect(portB).toBeLessThanOrEqual(3499);
  });
});

describe('runInit legacy backfill', () => {
  it('registers a pre-existing workspace.json port missing from the registry', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-legacy-'));
    const otherDir = mkdtempSync(join(tmpdir(), 'plandesk-legacy-other-'));
    try {
      // Simulate a legacy install: workspace.json exists but predates the registry.
      writeWorkspaceJson(dataDir, 3450);
      expect(readPortRegistry().assignments['3450']).toBeUndefined();

      await runInit(dataDir);

      expect(readPortRegistry().assignments['3450']).toBe(dataDir);
      // A different project's assignPort must now treat 3450 as owned and skip it.
      expect(isPortOwnedByAnotherProject(readPortRegistry(), 3450, otherDir)).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe('createListenErrorHandler', () => {
  it('reports port-in-use and exits with code 1', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let exitCode = 0;
    const exit = ((code: number) => {
      exitCode = code;
      throw new Error('exit');
    }) as (code: number) => never;

    const handler = createListenErrorHandler(3847, exit);
    expect(() => {
      handler(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }));
    }).toThrow('exit');

    expect(exitCode).toBe(1);
    expect(stderr.mock.calls.flat().join('')).toContain('already in use');
    stderr.mockRestore();
  });
});

describe('startServer', () => {
  const servers: Array<ReturnType<typeof startServer> | ReturnType<typeof createServer>> = [];

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

    const server = startServer({ port, dataDir });
    servers.push(server);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const info = readServerInfo(dataDir);
    expect(info?.port).toBe(port);
    expect(info?.pid).toBe(process.pid);

    // serve registers the port it actually bound, so other projects avoid it.
    expect(readPortRegistry().assignments[String(port)]).toBe(dataDir);

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    servers.splice(servers.indexOf(server), 1);
    expect(readServerInfo(dataDir)).toBeUndefined();

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

  it('rotates to a different in-range port when the requested port is in use', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-rotate-'));
    await runInit(dataDir);
    const port = readWorkspaceJson(dataDir)?.port;
    if (port === undefined) {
      throw new Error('expected an assigned port');
    }
    // Block the project's own assigned in-range port so rotation must pick
    // another candidate from the 3400–3499 range, not options.port + attempt.
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(port, DEFAULT_BIND_HOST, () => {
        resolve();
      });
    });
    servers.push(blocker);

    let exitCode = 0;
    const exit = ((code: number) => {
      exitCode = code;
    }) as (code: number) => never;

    const server = startServer({ port, dataDir }, exit);
    servers.push(server);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : 0;
    expect(exitCode).toBe(0);
    expect(boundPort).not.toBe(port);
    expect(boundPort).toBeGreaterThanOrEqual(3400);
    expect(boundPort).toBeLessThanOrEqual(3499);

    const res = await fetch(`http://127.0.0.1:${String(boundPort)}/api/v1/health`);
    expect(res.status).toBe(200);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it('exits 1 in strict-port mode when the port is in use', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-strict-'));
    await runInit(dataDir);
    const port = await blockedPort();

    let exitCode = 0;
    const exit = ((code: number) => {
      exitCode = code;
    }) as (code: number) => never;

    startServer({ port, dataDir, strictPort: true }, exit);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(exitCode).toBe(1);

    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('resolveDataDir', () => {
  it('uses override when provided', () => {
    expect(resolveDataDir('/tmp/custom')).toBe('/tmp/custom');
  });

  it('reads PLANDESK_DATA_DIR when override is absent', () => {
    vi.stubEnv('PLANDESK_DATA_DIR', '/data');
    expect(resolveDataDir()).toBe('/data');
    vi.unstubAllEnvs();
  });

  it('finds local .plandesk/ dir when present', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-resolve-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    mkdirSync(plandeskDir);
    try {
      expect(resolveDataDir(undefined, tmpDir)).toBe(plandeskDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('findLocalPlandeskDir', () => {
  it('returns undefined when no .plandesk/ exists in the tree', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-find-'));
    try {
      expect(findLocalPlandeskDir(tmpDir)).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds .plandesk/ in the given directory', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'plandesk-find-'));
    const plandeskDir = join(tmpDir, '.plandesk');
    mkdirSync(plandeskDir);
    try {
      expect(findLocalPlandeskDir(tmpDir)).toBe(plandeskDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds .plandesk/ in a parent directory', () => {
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

describe('resolveInitDataDir', () => {
  it('uses override when provided', () => {
    expect(resolveInitDataDir('/tmp/custom')).toBe('/tmp/custom');
  });

  it('reads PLANDESK_DATA_DIR when override is absent', () => {
    vi.stubEnv('PLANDESK_DATA_DIR', '/data');
    expect(resolveInitDataDir()).toBe('/data');
    vi.unstubAllEnvs();
  });

  it('defaults to .plandesk/ in cwd (not ~/.plandesk)', () => {
    const result = resolveInitDataDir();
    expect(result).toBe(join(process.cwd(), '.plandesk'));
  });
});
