import { describe, expect, it, vi } from 'vitest';
import {
  authorizeUrl,
  githubConfigFromEnv,
  resolveGithubIdentity,
  userRefFromGithubId,
  GithubOAuthError,
  type GithubConfig,
} from './github.js';

const baseConfig: GithubConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: 'https://plandesk.test/api/v1/auth/github/callback',
};

describe('userRefFromGithubId', () => {
  it('keys identity on the numeric id, never the login', () => {
    expect(userRefFromGithubId(1234)).toBe('github:1234');
  });
});

describe('authorizeUrl', () => {
  it('sends client id, callback, state and a read-only scope', () => {
    const url = new URL(authorizeUrl(baseConfig, 'state-value'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(baseConfig.callbackUrl);
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('scope')).toBe('read:user');
  });

  it('never puts the client secret in the browser-visible URL', () => {
    expect(authorizeUrl(baseConfig, 'state-value')).not.toContain('client-secret');
  });
});

describe('resolveGithubIdentity', () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('exchanges the code server-side and returns the identity', async () => {
    const doFetch = vi.fn((input: string, init?: RequestInit) => {
      void init;
      const url = input;
      if (url.includes('access_token')) {
        return Promise.resolve(jsonResponse({ access_token: 'gho_secret' }));
      }
      return Promise.resolve(jsonResponse({ id: 42, login: 'ada', name: 'Ada L' }));
    });

    const identity = await resolveGithubIdentity({ ...baseConfig, fetch: doFetch }, 'the-code');

    expect(identity).toEqual({ id: 42, login: 'ada', name: 'Ada L' });

    // The secret travels in the POST body to GitHub, never in a URL.
    const exchange = doFetch.mock.calls[0];
    expect(String(exchange?.[0])).toContain('login/oauth/access_token');
    const exchangeBody = exchange?.[1]?.body;
    if (typeof exchangeBody !== 'string') {
      throw new Error('expected GitHub token exchange body to be a string');
    }
    const body = JSON.parse(exchangeBody) as {
      client_secret: string;
      code: string;
    };
    expect(body.client_secret).toBe('client-secret');
    expect(body.code).toBe('the-code');

    // The access token is used once for the identity lookup...
    const lookup = doFetch.mock.calls[1];
    const headers = lookup?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gho_secret');
    // ...and never returned to the caller, so nothing can persist it.
    expect(JSON.stringify(identity)).not.toContain('gho_secret');
  });

  it('reports a rejected exchange as an OAuth error', async () => {
    const doFetch = vi.fn(() => Promise.resolve(jsonResponse({ error: 'bad_verification_code' })));
    await expect(
      resolveGithubIdentity({ ...baseConfig, fetch: doFetch }, 'nope'),
    ).rejects.toBeInstanceOf(GithubOAuthError);
  });

  it('reports a failed user lookup as an OAuth error', async () => {
    const doFetch = vi.fn((input: string) => {
      if (input.includes('access_token')) {
        return Promise.resolve(jsonResponse({ access_token: 'gho_secret' }));
      }
      return Promise.resolve(new Response('nope', { status: 401 }));
    });
    await expect(
      resolveGithubIdentity({ ...baseConfig, fetch: doFetch }, 'code'),
    ).rejects.toBeInstanceOf(GithubOAuthError);
  });
});

describe('githubConfigFromEnv', () => {
  it('is undefined when nothing is configured — the self-host default (REQ-20)', () => {
    expect(githubConfigFromEnv({})).toBeUndefined();
  });

  it('builds a config when all three are present', () => {
    expect(
      githubConfigFromEnv({
        PLANDESK_GITHUB_CLIENT_ID: 'id',
        PLANDESK_GITHUB_CLIENT_SECRET: 'secret',
        PLANDESK_GITHUB_CALLBACK_URL: 'https://x.test/cb',
        PLANDESK_DASHBOARD_URL: 'https://x.test/board',
      }),
    ).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'https://x.test/cb',
      dashboardUrl: 'https://x.test/board',
    });
  });

  it('defaults the dashboard redirect to the app root', () => {
    expect(
      githubConfigFromEnv({
        PLANDESK_GITHUB_CLIENT_ID: 'id',
        PLANDESK_GITHUB_CLIENT_SECRET: 'secret',
        PLANDESK_GITHUB_CALLBACK_URL: 'https://x.test/cb',
      })?.dashboardUrl,
    ).toBe('/');
  });

  it('throws on a half-configured app rather than silently disabling sign-in', () => {
    expect(() => githubConfigFromEnv({ PLANDESK_GITHUB_CLIENT_ID: 'id' })).toThrow(
      /PLANDESK_GITHUB_CLIENT_SECRET/,
    );
    expect(() =>
      githubConfigFromEnv({
        PLANDESK_GITHUB_CLIENT_ID: 'id',
        PLANDESK_GITHUB_CLIENT_SECRET: 'secret',
      }),
    ).toThrow(/PLANDESK_GITHUB_CALLBACK_URL/);
  });

  it('treats blank strings as unset', () => {
    expect(
      githubConfigFromEnv({
        PLANDESK_GITHUB_CLIENT_ID: '  ',
        PLANDESK_GITHUB_CLIENT_SECRET: '',
      }),
    ).toBeUndefined();
  });
});
