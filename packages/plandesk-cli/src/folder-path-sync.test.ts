import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncRepoFolderPathViaApi } from './folder-path-sync.js';

let server: Server | undefined;

afterEach(async () => {
  const open = server;
  server = undefined;
  if (open) {
    await new Promise((done) => open.close(done));
  }
});

/** A project API that records request headers and reports folder_path unset. */
async function listen(host: string): Promise<{ port: number; seen: IncomingHttpHeaders[] }> {
  const seen: IncomingHttpHeaders[] = [];
  const listening = createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folder_path: null }));
  });
  server = listening;
  await new Promise<void>((done) => {
    listening.listen(0, host, done);
  });
  return { port: (listening.address() as AddressInfo).port, seen };
}

describe('syncRepoFolderPathViaApi loopback owner', () => {
  it.each([
    ['127.0.0.1', '127.0.0.1'],
    ['::1', '[::1]'],
  ])('sends no bearer token to a loopback server on %s', async (bindHost, urlHost) => {
    const { port, seen } = await listen(bindHost);
    const repo = mkdtempSync(join(tmpdir(), 'plandesk-fps-'));
    const result = await syncRepoFolderPathViaApi(
      `http://${urlHost}:${String(port)}`,
      'p1',
      repo,
      'secret-token',
      true,
    );
    expect(result.status).toBe('set');
    expect(seen.length).toBe(2);
    expect(seen.map((h) => h.authorization)).toEqual([undefined, undefined]);
  });
});
