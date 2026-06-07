import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIND_HOST, DEFAULT_PORT, parseArgs, resolveDataDir, workspaceDbPath } from './args.js';
import { runInit } from './init.js';
import { createListenErrorHandler, startServer } from './serve.js';

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
    });
  });

  it('parses serve with port and data-dir', () => {
    expect(
      parseArgs(['node', 'plandesk', 'serve', '--port', '4000', '--data-dir', '/tmp/ws']),
    ).toEqual({
      command: 'serve',
      port: 4000,
      dataDir: '/tmp/ws',
    });
  });

  it('returns help for empty argv', () => {
    expect(parseArgs(['node', 'plandesk'])).toEqual({ command: 'help' });
  });
});

describe('bind host', () => {
  it('defaults serve bind host to loopback', () => {
    expect(BIND_HOST).toBe('127.0.0.1');
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
      probe.listen(0, BIND_HOST, () => {
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

    const res = await fetch(`http://${BIND_HOST}:${String(port)}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    rmSync(dataDir, { recursive: true, force: true });
  });

  it('exits 1 when the port is already in use', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-serve-busy-'));
    runInit(dataDir);
    const port = await new Promise<number>((resolve) => {
      const blocker = createServer();
      blocker.listen(0, BIND_HOST, () => {
        const address = blocker.address();
        if (address !== null && typeof address !== 'object') {
          throw new Error('expected TCP address');
        }
        resolve(address?.port ?? 0);
      });
      servers.push(blocker);
    });

    let exitCode = 0;
    const exit = ((code: number) => {
      exitCode = code;
    }) as (code: number) => never;

    startServer({ port, dataDir }, exit);

    await expect(
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (exitCode === 1) {
            resolve();
            return;
          }
          reject(new Error(`expected exit 1, got ${String(exitCode)}`));
        }, 200);
        timer.unref();
      }),
    ).resolves.toBeUndefined();

    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('resolveDataDir', () => {
  it('uses override when provided', () => {
    expect(resolveDataDir('/tmp/custom')).toBe('/tmp/custom');
  });
});
