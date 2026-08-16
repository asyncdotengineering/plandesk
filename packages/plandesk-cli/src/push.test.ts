import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCliConfig } from './config.js';
import { TOKEN_ENV_VAR } from './connect-artifacts.js';
import { resolvePromoteServerUrl, resolvePromoteToken } from './push.js';

const tempDirs: string[] = [];
const savedEnvToken = process.env[TOKEN_ENV_VAR];

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-push-'));
  tempDirs.push(dir);
  return dir;
}

function writeRepoToken(repoDir: string, token: string): void {
  mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
  writeFileSync(join(repoDir, '.plandesk', 'token'), `${token}\n`, 'utf8');
}

function writeRepoConfig(repoDir: string, serverUrl: string): void {
  mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
  writeFileSync(
    join(repoDir, '.plandesk', 'config.json'),
    `${JSON.stringify(
      {
        version: 'plandesk-connect-v1',
        serverUrl,
        projectId: 'proj-1',
        projectName: 'test',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

beforeEach(() => {
  Reflect.deleteProperty(process.env, TOKEN_ENV_VAR);
});

afterEach(() => {
  if (savedEnvToken === undefined) {
    Reflect.deleteProperty(process.env, TOKEN_ENV_VAR);
  } else {
    process.env[TOKEN_ENV_VAR] = savedEnvToken;
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? '', { recursive: true, force: true });
  }
});

describe('resolvePromoteToken — login→push seam', () => {
  it('returns global login token with no env and no repo token', () => {
    const home = makeTemp();
    const repoDir = makeTemp();
    writeCliConfig(
      { server: 'https://plan.example', token: 'global-from-login', orgId: 'org-1' },
      home,
    );

    expect(resolvePromoteToken(repoDir, home)).toBe('global-from-login');
  });

  it('precedence: env beats global beats repo', () => {
    const home = makeTemp();
    const repoDir = makeTemp();
    writeCliConfig({ server: 'https://plan.example', token: 'global-token', orgId: 'org-1' }, home);
    writeRepoToken(repoDir, 'repo-token');

    expect(resolvePromoteToken(repoDir, home)).toBe('global-token');

    process.env[TOKEN_ENV_VAR] = 'env-token';
    expect(resolvePromoteToken(repoDir, home)).toBe('env-token');

    Reflect.deleteProperty(process.env, TOKEN_ENV_VAR);
    writeCliConfig({ server: 'https://plan.example', token: '', orgId: 'org-1' }, home);
    // Empty global token is skipped → repo wins.
    expect(resolvePromoteToken(repoDir, home)).toBe('repo-token');
  });

  it('falls back to repo token when no env and no global config', () => {
    const home = makeTemp();
    const repoDir = makeTemp();
    writeRepoToken(repoDir, 'repo-only');

    expect(resolvePromoteToken(repoDir, home)).toBe('repo-only');
  });

  it('throws a clear error when no token source is set', () => {
    const home = makeTemp();
    const repoDir = makeTemp();

    expect(() => resolvePromoteToken(repoDir, home)).toThrow(
      /Token is required for promote.*plandesk login/,
    );
  });
});

describe('resolvePromoteServerUrl — flag > repo > global', () => {
  it('uses --remote/--url over repo and global', () => {
    const home = makeTemp();
    const repoDir = makeTemp();
    writeRepoConfig(repoDir, 'http://127.0.0.1:3450');
    writeCliConfig({ server: 'https://global.example', token: 't', orgId: 'o' }, home);

    expect(resolvePromoteServerUrl(repoDir, 'https://flag.example/', home)).toBe(
      'https://flag.example',
    );
  });

  it('uses repo serverUrl over global login server', () => {
    const home = makeTemp();
    const repoDir = makeTemp();
    writeRepoConfig(repoDir, 'http://127.0.0.1:3450');
    writeCliConfig({ server: 'https://global.example', token: 't', orgId: 'o' }, home);

    expect(resolvePromoteServerUrl(repoDir, undefined, home)).toBe('http://127.0.0.1:3450');
  });

  it('falls back to global login server when repo has no config', () => {
    const home = makeTemp();
    const repoDir = makeTemp();
    writeCliConfig({ server: 'https://plan.asyncdot.com', token: 't', orgId: 'o' }, home);

    expect(resolvePromoteServerUrl(repoDir, undefined, home)).toBe('https://plan.asyncdot.com');
  });
});
