import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.js';
import { DEPLOY_TARGETS, deploySpecUrl, formatDeployIndex, formatUnknownTarget } from './deploy.js';

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
  return { code, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

const SPEC_BODY =
  '---\ntarget: cloudflare\n---\n\n# Deploy Plan Desk to Cloudflare\n\nYou are an AI coding agent.\n';

function startRegistry(handler: (target: string) => { status: number; body: string }): Promise<{
  base: string;
  close: () => void;
}> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const match = /^\/deploy\/(.+)\.md$/.exec(req.url ?? '');
      if (match === null) {
        res.writeHead(404).end('not found');
        return;
      }
      const { status, body } = handler(match[1] ?? '');
      res.writeHead(status, { 'content-type': 'text/markdown' }).end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        base: `http://127.0.0.1:${String(port)}`,
        close: () => {
          server.close();
        },
      });
    });
  });
}

describe('plandesk deploy', () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    while (servers.length > 0) {
      servers.pop()?.close();
    }
    vi.unstubAllEnvs();
  });

  it('lists deploy guides when no target is given', async () => {
    const { code, stdout } = await captureIo(() => main(['node', 'plandesk', 'deploy']));
    expect(code).toBe(0);
    expect(stdout).toContain('Available deploy guides:');
    expect(stdout).toContain('cloudflare');
    expect(stdout).toContain('fly');
    expect(stdout).toContain('docker');
    expect(stdout).toContain('plandesk deploy cloudflare | claude');
  });

  it('fetches and prints the spec for a known target', async () => {
    const registry = await startRegistry((target) =>
      target === 'cloudflare' ? { status: 200, body: SPEC_BODY } : { status: 404, body: 'nope' },
    );
    servers.push(registry);
    vi.stubEnv('PLANDESK_DOCS_URL', registry.base);

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'deploy', 'cloudflare']),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('# Deploy Plan Desk to Cloudflare');
    expect(stdout).toContain('You are an AI coding agent.');
  });

  it('rejects an unknown target without hitting the network', async () => {
    const { code, stderr } = await captureIo(() => main(['node', 'plandesk', 'deploy', 'aws']));
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown deploy target: aws');
    expect(stderr).toContain('Available targets: cloudflare');
  });

  it('reports the direct URL when the registry returns an error', async () => {
    const registry = await startRegistry(() => ({ status: 404, body: 'missing' }));
    servers.push(registry);
    vi.stubEnv('PLANDESK_DOCS_URL', registry.base);

    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'deploy', 'cloudflare']),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('unavailable');
    expect(stderr).toContain(`${registry.base}/deploy/cloudflare.md`);
  });

  it('builds the spec URL from PLANDESK_DOCS_URL, trimming a trailing slash', async () => {
    vi.stubEnv('PLANDESK_DOCS_URL', 'https://example.test/');
    expect(deploySpecUrl('cloudflare')).toBe('https://example.test/deploy/cloudflare.md');
  });

  it('exposes a non-empty target index and formatters', async () => {
    expect(DEPLOY_TARGETS.length).toBeGreaterThan(0);
    expect(formatDeployIndex()).toContain('cloudflare');
    expect(formatUnknownTarget('aws')).toContain('Unknown deploy target: aws');
  });
});
