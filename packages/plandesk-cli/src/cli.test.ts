import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crashCourse,
  DEFAULT_BIND_HOST,
  DEFAULT_PORT,
  isLoopbackHost,
  parseArgs,
  resolveAuthPassword,
  resolveBindHost,
  resolveDataDir,
  workspaceDbPath,
} from './args.js';
import { runInit } from './init.js';
import { createListenErrorHandler, startServer, validateServeBind } from './serve.js';

describe('parseArgs', () => {
  it('parses init with data-dir override', () => {
    expect(parseArgs(['node', 'plandesk', 'init', '--data-dir', '/tmp/ws'])).toEqual({
      command: 'init',
      dataDir: '/tmp/ws',
    });
  });

  it('parses serve with default port', () => {
    expect(parseArgs(['node', 'plandesk', 'serve'])).toEqual({
      command: 'serve',
      port: DEFAULT_PORT,
      strictPort: false,
    });
  });

  it('parses serve with --strict-port', () => {
    expect(parseArgs(['node', 'plandesk', 'serve', '--strict-port'])).toEqual({
      command: 'serve',
      port: DEFAULT_PORT,
      strictPort: true,
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
  it('defaults serve bind host to loopback', () => {
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
  it('refuses non-loopback bind without PLANDESK_AUTH_PASSWORD', () => {
    vi.stubEnv('PLANDESK_AUTH_PASSWORD', '');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let exitCode = 0;
    const exit = ((code: number) => {
      exitCode = code;
      throw new Error('exit');
    }) as (code: number) => never;

    expect(() => {
      validateServeBind({ port: 3847, host: '0.0.0.0' }, exit);
    }).toThrow('exit');

    expect(exitCode).toBe(1);
    expect(stderr.mock.calls.flat().join('')).toContain('PLANDESK_AUTH_PASSWORD');
    stderr.mockRestore();
    vi.unstubAllEnvs();
  });

  it('allows non-loopback bind when PLANDESK_AUTH_PASSWORD is set', () => {
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
  it('creates a migrated workspace.db in the data dir', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-init-'));
    try {
      const dbPath = runInit(dataDir);
      expect(dbPath).toBe(workspaceDbPath(dataDir));
      const db = runInit(dataDir);
      expect(db).toBe(dbPath);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
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

  it('responds to health on loopback', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-'));
    runInit(dataDir);
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

    const res = await fetch(`http://${DEFAULT_BIND_HOST}:${String(port)}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

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

  it('rotates to the next free port when the requested port is in use', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-rotate-'));
    runInit(dataDir);
    const port = await blockedPort();

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
    expect(boundPort).toBeGreaterThan(port);

    const res = await fetch(`http://${DEFAULT_BIND_HOST}:${String(boundPort)}/api/v1/health`);
    expect(res.status).toBe(200);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it('exits 1 in strict-port mode when the port is in use', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-strict-'));
    runInit(dataDir);
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
});
