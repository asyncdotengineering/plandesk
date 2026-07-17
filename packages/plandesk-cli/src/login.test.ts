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

/**
 * A fetch stub that answers /auth/methods and /auth/device/start once, then
 * replays `polls` in order for each /auth/device/poll.
 */
function deviceServer(polls: unknown[], startInterval = 5): { fetch: typeof globalThis.fetch } {
  const queue = [...polls];
  const stub = ((url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith('/auth/methods')) return Promise.resolve(json({ method: 'device' }));
    if (href.endsWith('/auth/device/start')) {
      return Promise.resolve(
        json({
          auth_id: 'auth-1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          interval: startInterval,
          expires_in: 900,
        }),
      );
    }
    if (href.endsWith('/auth/device/poll')) {
      const next = queue.shift();
      if (next === undefined) throw new Error('poll called more times than the test scripted');
      return Promise.resolve(json(next));
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as unknown as typeof globalThis.fetch;
  return { fetch: stub };
}

const SUCCESS = { token: 'plandesk_tok_abc', org_id: 'org-1', org_name: 'Acme', login: 'octocat' };

describe('runLogin — device flow', () => {
  it('polls until success and writes the CLI config', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([{ status: 'pending' }, SUCCESS]);
    const slept: number[] = [];

    const config = await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(config).toEqual({ server: 'https://plan.asyncdot.com', token: SUCCESS.token, orgId: 'org-1' });
    expect(JSON.parse(readFileSync(cliConfigPath(home), 'utf8'))).toEqual(config);
    // One pending poll → exactly one wait, at the server-advertised interval.
    expect(slept).toEqual([5000]);
  });

  it('prints the user code and verification URI so the human can act', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([SUCCESS]);
    let printed = '';

    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      sleep: () => Promise.resolve(),
      out: {
        write: (chunk: string) => {
          printed += chunk;
          return true;
        },
      } as unknown as NodeJS.WritableStream,
    });

    expect(printed).toContain('ABCD-1234');
    expect(printed).toContain('https://github.com/login/device');
  });

  /**
   * RFC 8628 §3.5 — "the interval MUST be increased by 5 seconds for this and
   * all subsequent requests". The increase is cumulative and permanent, so a
   * second slow_down must compound onto the first, and a later plain pending
   * must NOT fall back to the original interval.
   */
  it('adds 5s per slow_down, cumulatively, and keeps the raised interval afterwards', async () => {
    const home = makeHome();
    const { fetch } = deviceServer(
      [
        { status: 'pending', slow_down: true },
        { status: 'pending', slow_down: true },
        { status: 'pending' },
        SUCCESS,
      ],
      5,
    );
    const slept: number[] = [];

    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    // 5 → +5 = 10 → +5 = 15 → stays 15 (no reset on a plain pending).
    expect(slept).toEqual([10_000, 15_000, 15_000]);
  });

  it('honours a start interval above the default before any slow_down', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([{ status: 'pending' }, { status: 'pending', slow_down: true }, SUCCESS], 10);
    const slept: number[] = [];

    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    // Starts at GitHub's advertised 10s; slow_down raises it to 15 — never down to 5.
    expect(slept).toEqual([10_000, 15_000]);
  });

  it('fails with a clear message when the code expires, and writes no config', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([{ status: 'expired' }]);

    await expect(
      runLogin('https://plan.asyncdot.com', {
        fetch,
        home,
        sleep: () => Promise.resolve(),
        out: { write: () => true } as unknown as NodeJS.WritableStream,
      }),
    ).rejects.toThrow(/expired/i);

    expect(() => readFileSync(cliConfigPath(home), 'utf8')).toThrow();
  });

  it('strips a trailing slash from the server URL', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([SUCCESS]);

    const config = await runLogin('https://plan.asyncdot.com/', {
      fetch,
      home,
      sleep: () => Promise.resolve(),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(config.server).toBe('https://plan.asyncdot.com');
  });

  it('never sends the CLI to github.com — only to the Plan Desk server', async () => {
    const home = makeHome();
    const seen: string[] = [];
    const inner = deviceServer([{ status: 'pending', slow_down: true }, SUCCESS]).fetch;
    const recording = ((url: string | URL | Request, init?: RequestInit) => {
      seen.push(String(url));
      return inner(url as string, init);
    }) as unknown as typeof globalThis.fetch;

    await runLogin('https://plan.asyncdot.com', {
      fetch: recording,
      home,
      sleep: () => Promise.resolve(),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((url) => url.startsWith('https://plan.asyncdot.com/'))).toBe(true);
    expect(seen.some((url) => url.includes('github.com'))).toBe(false);
  });
});

describe('runLogin — token paste path (BA4b-2 owner key)', () => {
  it('stores { server, token, orgId } from /auth/session after paste', async () => {
    const home = makeHome();
    const ownerToken = 'ba_owner_key_for_cli_paste';
    const orgId = 'org-owner-wide';
    const sessionAuths: string[] = [];

    const fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/auth/methods')) {
        return Promise.resolve(json({ method: 'token' }));
      }
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
});

describe('runWhoami / runLogout', () => {
  it('whoami reports the logged-in server and org', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([SUCCESS]);
    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      sleep: () => Promise.resolve(),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    expect(runWhoami(home)).toEqual({
      server: 'https://plan.asyncdot.com',
      token: SUCCESS.token,
      orgId: 'org-1',
    });
  });

  it('whoami tells an unauthenticated user what to run', () => {
    expect(() => runWhoami(makeHome())).toThrow(/plandesk login/);
  });

  it('logout removes the stored credentials', async () => {
    const home = makeHome();
    const { fetch } = deviceServer([SUCCESS]);
    await runLogin('https://plan.asyncdot.com', {
      fetch,
      home,
      sleep: () => Promise.resolve(),
      out: { write: () => true } as unknown as NodeJS.WritableStream,
    });

    runLogout(home);

    expect(() => runWhoami(home)).toThrow(/plandesk login/);
  });

  it('logout is a no-op when nobody is logged in', () => {
    expect(() => runLogout(makeHome())).not.toThrow();
  });
});
