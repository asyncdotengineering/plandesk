import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigFileError,
  resolveServerConfig,
  SERVER_CONFIG_FILENAME,
  SECRET_CONFIG_KEYS,
} from './config.js';
import { DEFAULT_BIND_HOST, DEFAULT_PORT } from './args.js';

const tempDirs: string[] = [];

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-config-'));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dataDir: string, json: string): string {
  const path = join(dataDir, SERVER_CONFIG_FILENAME);
  writeFileSync(path, json, 'utf8');
  return path;
}

beforeEach(() => {
  // Clear any host env that resolveDataDir would otherwise consult.
  delete process.env.PLANDESK_DATA_DIR;
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveServerConfig — defaults', () => {
  it('falls back to defaults with no file and no env (file not required, REQ-3)', () => {
    const dataDir = makeDataDir();
    const resolved = resolveServerConfig({ dataDir, env: {} });
    expect(resolved.values.host).toBe(DEFAULT_BIND_HOST);
    expect(resolved.values.port).toBe(DEFAULT_PORT);
    expect(resolved.values.storage).toEqual({ kind: 'local' });
    expect(resolved.values.dbUrl).toBeUndefined();
    expect(resolved.values.github).toBeUndefined();
    expect(resolved.configFile).toBeUndefined();
    expect(resolved.sources.host).toBe('default');
    expect(resolved.sources.port).toBe('default');
    expect(resolved.sources.storage).toBe('default');
  });

  it('a missing explicit config path is not an error', () => {
    const resolved = resolveServerConfig({ configPath: '/no/such/plandesk.server.json', env: {} });
    expect(resolved.values.host).toBe(DEFAULT_BIND_HOST);
    expect(resolved.configFile).toBeUndefined();
  });
});

describe('resolveServerConfig — precedence env > file > default (REQ-2)', () => {
  it('env host overrides file host', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ host: '0.0.0.0', port: 4000 }));
    const resolved = resolveServerConfig({ dataDir, env: { PLANDESK_HOST: '1.2.3.4' } });
    expect(resolved.values.host).toBe('1.2.3.4');
    expect(resolved.sources.host).toBe('env');
  });

  it('file host overrides default when env unset', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ host: '0.0.0.0' }));
    const resolved = resolveServerConfig({ dataDir, env: {} });
    expect(resolved.values.host).toBe('0.0.0.0');
    expect(resolved.sources.host).toBe('file');
  });

  it('file port overrides default', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ port: 4001 }));
    const resolved = resolveServerConfig({ dataDir, env: {} });
    expect(resolved.values.port).toBe(4001);
    expect(resolved.sources.port).toBe('file');
  });

  it('env port overrides file port', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ port: 4001 }));
    const resolved = resolveServerConfig({ dataDir, env: { PLANDESK_PORT: '9000' } });
    expect(resolved.values.port).toBe(9000);
    expect(resolved.sources.port).toBe('env');
  });

  it('resolves from a config file alone with no env (REQ-1, server boots from file alone)', () => {
    const dataDir = makeDataDir();
    writeConfig(
      dataDir,
      JSON.stringify({ host: '0.0.0.0', port: 4002, baseUrl: 'https://pd.test' }),
    );
    const resolved = resolveServerConfig({ dataDir, env: {} });
    expect(resolved.values.host).toBe('0.0.0.0');
    expect(resolved.values.port).toBe(4002);
    expect(resolved.values.baseUrl).toBe('https://pd.test');
    expect(resolved.configFile).toBe(join(dataDir, SERVER_CONFIG_FILENAME));
  });

  it('mixes sources per key (dbUrl from file, dbToken from env)', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ dbUrl: 'libsql://file.example' }));
    const resolved = resolveServerConfig({
      dataDir,
      env: { PLANDESK_DB_TOKEN: 'tok-env' },
    });
    expect(resolved.values.dbUrl).toBe('libsql://file.example');
    expect(resolved.sources.dbUrl).toBe('file');
    expect(resolved.values.dbToken).toBe('tok-env');
    expect(resolved.sources.dbToken).toBe('env');
  });

  it('accepts the canonical better-auth secret env name and prefers it over the legacy alias', () => {
    const resolved = resolveServerConfig({
      dataDir: makeDataDir(),
      env: {
        PLANDESK_BETTER_AUTH_SECRET: 'canonical-secret',
        PLANDESK_SESSION_SECRET: 'legacy-secret',
      },
    });
    expect(resolved.values.sessionSecret).toBe('canonical-secret');
    expect(resolved.sources.sessionSecret).toBe('env');
  });
});

describe('resolveServerConfig — storage', () => {
  it('local is the default', () => {
    const resolved = resolveServerConfig({ env: {}, dataDir: makeDataDir() });
    expect(resolved.values.storage).toEqual({ kind: 'local' });
    expect(resolved.sources.storage).toBe('default');
  });

  it('s3 from env credentials', () => {
    const resolved = resolveServerConfig({
      env: {
        PLANDESK_STORAGE: 's3',
        PLANDESK_S3_BUCKET: 'b',
        PLANDESK_S3_REGION: 'us-east-1',
        PLANDESK_S3_ACCESS_KEY_ID: 'ak',
        PLANDESK_S3_SECRET_ACCESS_KEY: 'sk',
      },
      dataDir: makeDataDir(),
    });
    expect(resolved.values.storage).toEqual({
      kind: 's3',
      bucket: 'b',
      region: 'us-east-1',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
    });
    expect(resolved.sources.storage).toBe('env');
  });

  it('s3 from file', () => {
    const dataDir = makeDataDir();
    writeConfig(
      dataDir,
      JSON.stringify({
        storage: {
          kind: 's3',
          bucket: 'fb',
          region: 'eu-west-1',
          accessKeyId: 'fak',
          secretAccessKey: 'fsk',
        },
      }),
    );
    const resolved = resolveServerConfig({ dataDir, env: {} });
    expect(resolved.values.storage.kind).toBe('s3');
    expect(resolved.sources.storage).toBe('file');
  });

  it('env s3 credential overrides the file value for that key', () => {
    const dataDir = makeDataDir();
    writeConfig(
      dataDir,
      JSON.stringify({
        storage: {
          kind: 's3',
          bucket: 'fb',
          region: 'r',
          accessKeyId: 'fak',
          secretAccessKey: 'fsk',
        },
      }),
    );
    const resolved = resolveServerConfig({
      dataDir,
      env: { PLANDESK_S3_BUCKET: 'env-bucket' },
    });
    expect(resolved.values.storage.kind).toBe('s3');
    expect((resolved.values.storage as { bucket: string }).bucket).toBe('env-bucket');
  });

  it('s3 with incomplete credentials throws', () => {
    expect(() =>
      resolveServerConfig({
        env: { PLANDESK_STORAGE: 's3', PLANDESK_S3_BUCKET: 'b' },
        dataDir: makeDataDir(),
      }),
    ).toThrow(/storage=s3 requires/);
  });
});

describe('resolveServerConfig — github', () => {
  it('unset github → undefined', () => {
    const resolved = resolveServerConfig({ env: {}, dataDir: makeDataDir() });
    expect(resolved.values.github).toBeUndefined();
  });

  it('complete github from file', () => {
    const dataDir = makeDataDir();
    writeConfig(
      dataDir,
      JSON.stringify({
        github: { clientId: 'cid', clientSecret: 'cs', callbackUrl: 'https://app/cb' },
      }),
    );
    const resolved = resolveServerConfig({ dataDir, env: {} });
    expect(resolved.values.github).toEqual({
      clientId: 'cid',
      clientSecret: 'cs',
      callbackUrl: 'https://app/cb',
      dashboardUrl: undefined,
    });
    expect(resolved.sources.github).toBe('file');
  });

  it('partial github throws (all-or-nothing)', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ github: { clientId: 'cid' } }));
    expect(() => resolveServerConfig({ dataDir, env: {} })).toThrow(
      /clientId, clientSecret and callbackUrl together/,
    );
  });
});

describe('resolveServerConfig — malformed file (clear error naming file + key)', () => {
  it('invalid JSON names the file', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, '{ not json');
    expect(() => resolveServerConfig({ dataDir, env: {} })).toThrow(ConfigFileError);
    expect(() => resolveServerConfig({ dataDir, env: {} })).toThrow(/invalid JSON/);
    expect(() => resolveServerConfig({ dataDir, env: {} })).toThrow(SERVER_CONFIG_FILENAME);
  });

  it('unknown key names the file and the key', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ bogusKey: 1 }));
    expect(() => resolveServerConfig({ dataDir, env: {} })).toThrow(/unknown key "bogusKey"/);
  });

  it('wrong-typed port names the key', () => {
    const dataDir = makeDataDir();
    writeConfig(dataDir, JSON.stringify({ port: 'not-a-port' }));
    expect(() => resolveServerConfig({ dataDir, env: {} })).toThrow(
      /"port" must be an integer port/,
    );
  });
});

describe('resolveServerConfig — secret keys are classified for redaction (REQ-4)', () => {
  it('classifies dbToken, authPassword, sessionSecret as secret', () => {
    expect(SECRET_CONFIG_KEYS.has('dbToken')).toBe(true);
    expect(SECRET_CONFIG_KEYS.has('authPassword')).toBe(true);
    expect(SECRET_CONFIG_KEYS.has('sessionSecret')).toBe(true);
    expect(SECRET_CONFIG_KEYS.has('host')).toBe(false);
  });
});
