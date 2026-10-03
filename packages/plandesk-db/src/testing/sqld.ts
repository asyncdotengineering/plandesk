import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// CI sets PLANDESK_REQUIRE_SQLD=1 so a missing binary fails the run instead of
// silently skipping the remote-database coverage.
export function findSqld(): string | undefined {
  const onPath = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'sqld'));
  const bin = [...onPath, join(homedir(), '.turso', 'sqld')].find((path) => existsSync(path));
  if (bin === undefined && process.env.PLANDESK_REQUIRE_SQLD === '1') {
    throw new Error('PLANDESK_REQUIRE_SQLD=1 but no sqld on PATH or at ~/.turso/sqld');
  }
  return bin;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolve(address.port);
      });
    });
  });
}

/**
 * Start a throwaway sqld on a free port with a temp data dir; returns its
 * `http:` URL and a `stop` that kills it and removes the dir. libSQL over HTTP
 * (Hrana) runs each request on its own stream, so connection-level PRAGMAs
 * don't carry between calls.
 */
export async function startSqld(binary: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-sqld-'));
  const proc = spawn(binary, ['--http-listen-addr', `127.0.0.1:${String(port)}`, '-d', dir], {
    stdio: 'ignore',
  });
  const stop = () => {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  const url = `http://127.0.0.1:${String(port)}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { url, stop };
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  stop();
  throw new Error(`sqld did not come up on ${url}`);
}
