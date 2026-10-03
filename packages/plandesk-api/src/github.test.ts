import { describe, expect, it } from 'vitest';
import { githubConfigFromEnv } from './github.js';

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
