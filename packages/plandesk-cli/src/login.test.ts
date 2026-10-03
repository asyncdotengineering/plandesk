import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.js';
import { runLogin, runLogout, runWhoami } from './login.js';
import { cliConfigPath, writeCliConfig } from './config.js';

const tempDirs: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-login-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? '', { recursive: true, force: true });
  }
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function requestHref(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (input instanceof Request) {
    return input.url;
  }
  throw new Error('unexpected fetch input');
}

describe('runLogin — token paste path (BA4b-2 owner key)', () => {
  it('stores { server, token, orgId } from /auth/session after paste', async () => {
    const home = makeHome();
    const ownerToken = 'ba_owner_key_for_cli_paste';
    const orgId = 'org-owner-wide';
    const sessionAuths: string[] = [];

    const fetch: typeof globalThis.fetch = (url, init) => {
      const href = requestHref(url);
      if (href.endsWith('/auth/session')) {
        const headers = init?.headers;
        let auth = '';
        if (headers instanceof Headers) {
          auth = headers.get('Authorization') ?? '';
        } else if (
          headers !== undefined &&
          typeof headers === 'object' &&
          'Authorization' in headers
        ) {
          auth = String((headers as Record<string, string>).Authorization);
        }
        sessionAuths.push(auth);
        return Promise.resolve(
          json({
            kind: 'apikey',
            role: 'owner',
            org: { id: orgId, name: 'Owner Org' },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    const config = await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      input: Readable.from([`${ownerToken}\n`]),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(config).toEqual({
      server: 'https://plan.asyncdot.com',
      token: ownerToken,
      orgId,
    });
    expect(JSON.parse(readFileSync(cliConfigPath(home), 'utf8'))).toEqual(config);
    expect(sessionAuths).toEqual([`Bearer ${ownerToken}`]);
  });

  it('strips a trailing slash from the server URL', async () => {
    const home = makeHome();
    const fetch: typeof globalThis.fetch = (url) => {
      const href = requestHref(url);
      if (href.endsWith('/auth/session')) {
        return Promise.resolve(
          json({
            kind: 'apikey',
            role: 'owner',
            org: { id: 'org-1', name: 'Acme' },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    const config = await runLogin('https://plan.asyncdot.com/', {
      fetch,
      home,
      input: Readable.from(['tok\n']),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(config.server).toBe('https://plan.asyncdot.com');
  });

  it('rejects empty paste', async () => {
    const home = makeHome();
    await expect(
      runLogin('https://plan.asyncdot.com', {
        fetch: (() => Promise.reject(new Error('should not fetch'))) as unknown as typeof fetch,
        home,
        input: Readable.from(['\n']),
        out: { write: () => true } as unknown as NodeJS.WritableStream,
      }),
    ).rejects.toThrow(/required/i);
  });
});

describe('runLogin — which server', () => {
  const quiet = { write: () => true } as unknown as NodeJS.WritableStream;

  it('with no --server and no saved login, refuses and names the --server flag', async () => {
    await expect(
      runLogin(undefined, {
        fetch: (() => Promise.reject(new Error('should not fetch'))) as unknown as typeof fetch,
        home: makeHome(),
        input: Readable.from(['tok\n']),
        out: quiet,
      }),
    ).rejects.toThrow('plandesk login --server <your Plan Desk URL>');
  });

  it('with no --server, logs in again to the saved server', async () => {
    const home = makeHome();
    writeCliConfig({ server: 'https://boards.example', token: 'old', orgId: 'org-1' }, home);
    const hrefs: string[] = [];
    const fetch: typeof globalThis.fetch = (url) => {
      hrefs.push(requestHref(url));
      return Promise.resolve(json({ org: { id: 'org-1' } }));
    };

    const config = await runLogin(undefined, {
      fetch,
      home,
      input: Readable.from(['new-tok\n']),
      out: quiet,
    });

    expect(hrefs).toEqual(['https://boards.example/api/v1/auth/session']);
    expect(config).toEqual({ server: 'https://boards.example', token: 'new-tok', orgId: 'org-1' });
  });

  it('`plandesk login` with nothing saved exits 1 with the --server hint', async () => {
    vi.stubEnv('HOME', makeHome());
    const stderr: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    let code: number;
    try {
      code = await main(['node', 'plandesk', 'login']);
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('plandesk login --server <your Plan Desk URL>');
  });
});

describe('runWhoami / runLogout', () => {
  it('whoami reports the logged-in server and org', async () => {
    const home = makeHome();
    const fetch: typeof globalThis.fetch = (url) => {
      const href = requestHref(url);
      if (href.endsWith('/auth/session')) {
        return Promise.resolve(
          json({ kind: 'apikey', role: 'owner', org: { id: 'org-1', name: 'Acme' } }),
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      input: Readable.from(['plandesk_tok_abc\n']),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(runWhoami(home)).toEqual({
      server: 'https://plan.asyncdot.com',
      token: 'plandesk_tok_abc',
      orgId: 'org-1',
    });
  });

  it('whoami tells an unauthenticated user what to run', () => {
    expect(() => runWhoami(makeHome())).toThrow(/plandesk login/);
  });

  it('logout removes the stored credentials', async () => {
    const home = makeHome();
    const fetch: typeof globalThis.fetch = (url) => {
      const href = requestHref(url);
      if (href.endsWith('/auth/session')) {
        return Promise.resolve(
          json({ kind: 'apikey', role: 'owner', org: { id: 'org-1', name: 'Acme' } }),
        );
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      input: Readable.from(['tok\n']),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    runLogout(home);

    expect(() => runWhoami(home)).toThrow(/plandesk login/);
  });

  it('logout is a no-op when nobody is logged in', () => {
    expect(() => {
      runLogout(makeHome());
    }).not.toThrow();
  });
});
