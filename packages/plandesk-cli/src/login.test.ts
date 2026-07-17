import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runLogin, runLogout, runWhoami } from './login.js';
import { cliConfigPath } from './config.js';

const tempDirs: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-login-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? '', { recursive: true, force: true });
  }
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('runLogin — token paste path (BA4b-2 owner key)', () => {
  it('stores { server, token, orgId } from /auth/session after paste', async () => {
    const home = makeHome();
    const ownerToken = 'ba_owner_key_for_cli_paste';
    const orgId = 'org-owner-wide';
    const sessionAuths: string[] = [];

    const fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
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
    }) as unknown as typeof globalThis.fetch;

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
    const fetch = ((url: string | URL | Request) => {
      const href = String(url);
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
    }) as unknown as typeof globalThis.fetch;

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

describe('runWhoami / runLogout', () => {
  it('whoami reports the logged-in server and org', async () => {
    const home = makeHome();
    const fetch = ((url: string | URL | Request) => {
      if (String(url).endsWith('/auth/session')) {
        return Promise.resolve(
          json({ kind: 'apikey', role: 'owner', org: { id: 'org-1', name: 'Acme' } }),
        );
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    }) as unknown as typeof globalThis.fetch;

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
    const fetch = ((url: string | URL | Request) => {
      if (String(url).endsWith('/auth/session')) {
        return Promise.resolve(
          json({ kind: 'apikey', role: 'owner', org: { id: 'org-1', name: 'Acme' } }),
        );
      }
      throw new Error(`unexpected fetch: ${String(url)}`);
    }) as unknown as typeof globalThis.fetch;

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
    expect(() => runLogout(makeHome())).not.toThrow();
  });
});
