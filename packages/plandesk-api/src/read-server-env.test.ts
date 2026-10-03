import { describe, expect, it } from 'vitest';
import { readServerEnv } from './read-server-env.js';

const S3 = {
  PLANDESK_S3_BUCKET: 'bucket',
  PLANDESK_S3_REGION: 'us-east-1',
  PLANDESK_S3_ACCESS_KEY_ID: 'AKIA',
  PLANDESK_S3_SECRET_ACCESS_KEY: 'shh',
};

const GITHUB = {
  PLANDESK_GITHUB_CLIENT_ID: 'id',
  PLANDESK_GITHUB_CLIENT_SECRET: 'secret',
  PLANDESK_GITHUB_CALLBACK_URL: 'https://x.test/api/auth/callback/github',
};

describe('readServerEnv — valid combinations', () => {
  it.each([
    ['empty env → nothing set, storage unchosen', {}, {}],
    [
      'scalars are trimmed',
      {
        PLANDESK_DB_URL: ' libsql://db.turso.io ',
        PLANDESK_DB_TOKEN: ' tok ',
        PLANDESK_BASE_URL: ' https://boards.example ',
        PLANDESK_BETTER_AUTH_SECRET: ' s3cret ',
        PLANDESK_AUTH_PASSWORD: ' pw ',
      },
      {
        dbUrl: 'libsql://db.turso.io',
        dbToken: 'tok',
        baseUrl: 'https://boards.example',
        authSecret: 's3cret',
        authPassword: 'pw',
      },
    ],
    [
      'blank and whitespace values mean unset',
      {
        PLANDESK_DB_URL: '',
        PLANDESK_DB_TOKEN: '   ',
        PLANDESK_BASE_URL: '',
        PLANDESK_BETTER_AUTH_SECRET: ' ',
        PLANDESK_AUTH_PASSWORD: '',
        PLANDESK_STORAGE: ' ',
        PLANDESK_GITHUB_CLIENT_ID: '',
        PLANDESK_GITHUB_CLIENT_SECRET: ' ',
        PLANDESK_GITHUB_CALLBACK_URL: '',
        PLANDESK_S3_BUCKET: '',
      },
      {},
    ],
    [
      'PLANDESK_STORAGE=db → bytes in the database',
      { PLANDESK_STORAGE: 'db' },
      { storage: { kind: 'db' } },
    ],
    [
      'legacy PLANDESK_STORAGE=local → db',
      { PLANDESK_STORAGE: 'local' },
      { storage: { kind: 'db' } },
    ],
    [
      'PLANDESK_STORAGE=s3 with all four vars, no endpoint',
      { PLANDESK_STORAGE: 's3', ...S3 },
      {
        storage: {
          kind: 's3',
          bucket: 'bucket',
          region: 'us-east-1',
          accessKeyId: 'AKIA',
          secretAccessKey: 'shh',
        },
      },
    ],
    [
      'PLANDESK_STORAGE=s3 with endpoint',
      { PLANDESK_STORAGE: ' s3 ', ...S3, PLANDESK_S3_ENDPOINT: ' https://r2.example ' },
      {
        storage: {
          kind: 's3',
          bucket: 'bucket',
          region: 'us-east-1',
          accessKeyId: 'AKIA',
          secretAccessKey: 'shh',
          endpoint: 'https://r2.example',
        },
      },
    ],
    [
      'GitHub all three',
      GITHUB,
      {
        github: {
          clientId: 'id',
          clientSecret: 'secret',
          callbackUrl: 'https://x.test/api/auth/callback/github',
        },
      },
    ],
    [
      'GitHub with dashboard url',
      { ...GITHUB, PLANDESK_DASHBOARD_URL: ' https://x.test/board ' },
      {
        github: {
          clientId: 'id',
          clientSecret: 'secret',
          callbackUrl: 'https://x.test/api/auth/callback/github',
          dashboardUrl: 'https://x.test/board',
        },
      },
    ],
    [
      'canonical secret wins when the legacy alias is also set',
      { PLANDESK_BETTER_AUTH_SECRET: 'new', PLANDESK_SESSION_SECRET: 'old' },
      { authSecret: 'new' },
    ],
  ])('%s', (_name, env, expected) => {
    // Unset keys are absent (or undefined) — compare against a fully-undefined base.
    expect(readServerEnv(env)).toEqual({
      dbUrl: undefined,
      dbToken: undefined,
      baseUrl: undefined,
      authSecret: undefined,
      authPassword: undefined,
      storage: undefined,
      github: undefined,
      ...expected,
    });
  });
});

describe('readServerEnv — invalid combinations fail loud', () => {
  it.each([
    ['GitHub id only', { PLANDESK_GITHUB_CLIENT_ID: 'id' }, /PLANDESK_GITHUB_CLIENT_SECRET/],
    [
      'GitHub missing callback',
      { PLANDESK_GITHUB_CLIENT_ID: 'id', PLANDESK_GITHUB_CLIENT_SECRET: 'secret' },
      /PLANDESK_GITHUB_CALLBACK_URL/,
    ],
    [
      'GitHub callback only',
      { PLANDESK_GITHUB_CALLBACK_URL: 'https://x.test/cb' },
      /PLANDESK_GITHUB_CLIENT_ID/,
    ],
    [
      's3 selected, bucket only',
      { PLANDESK_STORAGE: 's3', PLANDESK_S3_BUCKET: 'b' },
      /PLANDESK_S3_SECRET_ACCESS_KEY/,
    ],
    [
      's3 selected, secret key blank',
      { PLANDESK_STORAGE: 's3', ...S3, PLANDESK_S3_SECRET_ACCESS_KEY: ' ' },
      /PLANDESK_S3_SECRET_ACCESS_KEY/,
    ],
    ['s3 selected, no vars', { PLANDESK_STORAGE: 's3' }, /PLANDESK_S3_BUCKET/],
    ['S3 vars without PLANDESK_STORAGE=s3', S3, /PLANDESK_STORAGE=s3/],
    ['unknown storage kind', { PLANDESK_STORAGE: 'r2' }, /PLANDESK_STORAGE.*"r2"/],
    [
      'legacy PLANDESK_SESSION_SECRET alone',
      { PLANDESK_SESSION_SECRET: 'old' },
      /PLANDESK_BETTER_AUTH_SECRET/,
    ],
  ])('%s', (_name, env, message) => {
    expect(() => readServerEnv(env)).toThrow(message);
  });
});
