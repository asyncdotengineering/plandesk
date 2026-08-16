import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildEnv,
  ENV_ALLOWLIST,
  readBoundedFile,
  runHeadless,
  spawn,
  substitutePlaceholders,
} from './spawn.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Poll `kill(pid, 0)` until it throws ESRCH — proof the process is gone. */
async function waitForPidGone(pid: number, budgetMs = 5000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

const posix = describe.skipIf(process.platform === 'win32');

describe('buildEnv', () => {
  const SECRET_KEY = 'PLANDESK_TEST_SECRET';

  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env[SECRET_KEY];
  });

  afterEach(() => {
    if (savedSecret === undefined) {
      Reflect.deleteProperty(process.env, SECRET_KEY);
    } else {
      process.env[SECRET_KEY] = savedSecret;
    }
  });

  it('returns no key outside the allowlist, proven against the whole of process.env', () => {
    const env = buildEnv();

    expect(Object.keys(env).length).toBeLessThanOrEqual(ENV_ALLOWLIST.length);
    for (const key of Object.keys(process.env)) {
      if (!ENV_ALLOWLIST.includes(key)) {
        expect(env).not.toHaveProperty(key);
      }
    }
  });

  it('keeps a secret placed in process.env out of the child environment', () => {
    process.env[SECRET_KEY] = 'super-secret-board-credential';

    const env = buildEnv();

    expect(env[SECRET_KEY]).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('super-secret-board-credential');
  });

  it('includes HOME, because worker auth resolves from ~/.pi/agent/auth.json', () => {
    if (process.env.HOME === undefined) {
      throw new Error('test requires HOME in the runner environment');
    }

    expect(buildEnv().HOME).toBe(process.env.HOME);
  });

  it('adds explicit opt-ins and lets them override allowlisted values', () => {
    const env = buildEnv({ PLANDESK_WORK_TOKEN: 'opt-in', HOME: '/custom/home' });

    expect(env.PLANDESK_WORK_TOKEN).toBe('opt-in');
    expect(env.HOME).toBe('/custom/home');
  });
});

describe('substitutePlaceholders', () => {
  it('substitutes repo_path, prompt_file, and result_file into argv', () => {
    const argv = substitutePlaceholders(
      'agent run {prompt_file} --repo {repo_path} --out {result_file}',
      {
        repoPath: '/work/tree',
        promptFile: '/tmp/brief.md',
        resultFile: '/tmp/result.md',
      },
    );

    expect(argv).toEqual([
      'agent',
      'run',
      '/tmp/brief.md',
      '--repo',
      '/work/tree',
      '--out',
      '/tmp/result.md',
    ]);
  });

  it('splits shell-style words: quotes join, escapes unquote, mid-word quotes hold', () => {
    const argv = substitutePlaceholders('agent --effort="high" \'--flag two\' a\\ b', {
      repoPath: '/work/tree',
    });

    expect(argv).toEqual(['agent', '--effort=high', '--flag two', 'a b']);
  });

  it('keeps a substituted path with spaces as a single argument', () => {
    const argv = substitutePlaceholders('agent "{prompt_file}"', {
      repoPath: '/work/tree',
      promptFile: '/tmp/a b/brief.md',
    });

    expect(argv).toEqual(['agent', '/tmp/a b/brief.md']);
  });

  it('substitutes inside a larger token, like pi’s @{prompt_file}', () => {
    const argv = substitutePlaceholders('pi --print @{prompt_file}', {
      repoPath: '/work/tree',
      promptFile: '/tmp/brief.md',
    });

    expect(argv).toEqual(['pi', '--print', '@/tmp/brief.md']);
  });

  it('leaves a placeholder verbatim when its context entry is absent', () => {
    const argv = substitutePlaceholders('agent run {prompt_file} {result_file}', {
      repoPath: '/work/tree',
    });

    expect(argv).toEqual(['agent', 'run', '{prompt_file}', '{result_file}']);
  });

  it('returns an empty argv for an empty or whitespace-only template', () => {
    expect(substitutePlaceholders('', { repoPath: '/work/tree' })).toEqual([]);
    expect(substitutePlaceholders('   \n\t ', { repoPath: '/work/tree' })).toEqual([]);
  });
});

posix('spawn', () => {
  it('runs a command to exit, capturing output with pgid === pid', async () => {
    const result = await spawn({
      cmd: ['/bin/echo', 'hello'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 10_000,
    });

    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.pgid).toBe(result.pid);
  });

  it('captures stderr and a non-zero exit code', async () => {
    const result = await spawn({
      cmd: ['/bin/sh', '-c', 'echo oops 1>&2; exit 3'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 10_000,
    });

    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('oops\n');
  });

  it('delivers the brief on stdin and closes it', async () => {
    const result = await spawn({
      cmd: ['/bin/cat'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 10_000,
      stdin: 'the brief body',
    });

    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('the brief body');
  });

  it('enforces the timeout: kills the child and resolves reason timeout', async () => {
    const result = await spawn({
      cmd: ['/bin/sleep', '10'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 300,
    });

    expect(result.reason).toBe('timeout');
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(5000);
  });

  it(
    'a timeout kills a spawned grandchild too — the grandchild pid is gone',
    { timeout: 15_000 },
    async () => {
      const dir = makeTempDir('plandesk-spawn-');
      const pidFile = join(dir, 'grandchild.pid');
      // A shell that backgrounds a long sleep (the grandchild), records its
      // pid, then sleeps itself: the group is alive when the timeout fires.
      const script = '/bin/sleep 300 &\necho $! > "$PLANDESK_GRANDCHILD_PID_FILE"\n/bin/sleep 300';

      const result = await spawn({
        cmd: ['/bin/sh', '-c', script],
        cwd: dir,
        env: buildEnv({ PLANDESK_GRANDCHILD_PID_FILE: pidFile }),
        timeoutMs: 400,
      });

      expect(result.reason).toBe('timeout');
      const grandchildPid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      expect(Number.isInteger(grandchildPid)).toBe(true);
      expect(grandchildPid).toBeGreaterThan(0);
      expect(grandchildPid).not.toBe(result.pid);

      // The single most important assertion in this suite: the grandchild —
      // not merely the parent shell — is dead, and so is the whole group.
      await expect(waitForPidGone(grandchildPid)).resolves.toBe(true);
      expect(() => process.kill(-result.pgid, 0)).toThrow();
    },
  );

  it('an AbortSignal fired mid-run kills the child and resolves reason cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 150);

    const result = await spawn({
      cmd: ['/bin/sleep', '10'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    expect(result.reason).toBe('cancelled');
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it('caps captured output at maxOutputBytes and flags truncation', async () => {
    const result = await spawn({
      cmd: [process.execPath, '-e', 'process.stdout.write("a".repeat(100_000))'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 10_000,
      maxOutputBytes: 1000,
    });

    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(1000);
  });

  it('resolves reason spawn-error for a non-existent binary instead of throwing', async () => {
    const result = await spawn({
      cmd: ['/nonexistent/plandesk-no-such-binary', 'arg'],
      cwd: makeTempDir('plandesk-spawn-'),
      env: buildEnv(),
      timeoutMs: 10_000,
    });

    expect(result.reason).toBe('spawn-error');
    expect(result.exitCode).toBeNull();
    expect(result.pid).toBe(-1);
    expect(result.pgid).toBe(-1);
    expect(result.stderr).toContain('plandesk-no-such-binary');
  });

  it(
    'hands the child only the allowlisted environment — a secret never reaches it',
    { timeout: 15_000 },
    async () => {
      const saved = process.env.PLANDESK_TEST_SECRET;
      process.env.PLANDESK_TEST_SECRET = 'super-secret-board-credential';
      try {
        const result = await spawn({
          cmd: ['/usr/bin/env'],
          cwd: makeTempDir('plandesk-spawn-'),
          env: buildEnv(),
          timeoutMs: 10_000,
        });

        expect(result.reason).toBe('exited');
        expect(result.stdout).not.toContain('PLANDESK_TEST_SECRET');
        expect(result.stdout).not.toContain('super-secret-board-credential');
        // HOME is load-bearing: the child sees it too, not just buildEnv().
        expect(result.stdout).toContain(`HOME=${process.env.HOME ?? ''}`);
      } finally {
        if (saved === undefined) {
          delete process.env.PLANDESK_TEST_SECRET;
        } else {
          process.env.PLANDESK_TEST_SECRET = saved;
        }
      }
    },
  );
});

describe('readBoundedFile', () => {
  it('reads a file under the cap whole and flags nothing', () => {
    const dir = makeTempDir('plandesk-bounded-');
    const path = join(dir, 'result.md');
    writeFileSync(path, 'ok-result');

    expect(readBoundedFile(path, 500)).toEqual({ text: 'ok-result', truncated: false });
  });

  it('cuts at the cap and flags truncation', () => {
    const dir = makeTempDir('plandesk-bounded-');
    const path = join(dir, 'result.md');
    writeFileSync(path, 'x'.repeat(4096));

    expect(readBoundedFile(path, 1024)).toEqual({ text: 'x'.repeat(1024), truncated: true });
  });

  it('backs off to a valid UTF-8 boundary when the cut lands mid-sequence', () => {
    const dir = makeTempDir('plandesk-bounded-');
    const path = join(dir, 'result.md');
    writeFileSync(path, 'é'.repeat(10)); // 20 bytes; a 5-byte cut splits one é

    expect(readBoundedFile(path, 5)).toEqual({ text: 'é'.repeat(2), truncated: true });
  });

  it('returns undefined for a missing file', () => {
    expect(
      readBoundedFile(join(makeTempDir('plandesk-bounded-'), 'absent.md'), 100),
    ).toBeUndefined();
  });
});

posix('runHeadless', () => {
  it('writes the brief to a temp file and passes its path when {prompt_file} is present', async () => {
    const result = await runHeadless('/bin/cat {prompt_file}', 'brief-body-text', {
      cwd: makeTempDir('plandesk-headless-'),
      timeoutMs: 10_000,
    });

    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('brief-body-text'); // the child read the brief from the file
    expect(result.promptFile).toBeDefined();
    expect(existsSync(result.promptFile ?? '/')).toBe(false); // deleted afterwards
  });

  it('sends the brief on stdin when the template has no {prompt_file}', async () => {
    const result = await runHeadless('/bin/cat', 'brief-on-stdin', {
      cwd: makeTempDir('plandesk-headless-'),
      timeoutMs: 10_000,
    });

    expect(result.reason).toBe('exited');
    expect(result.stdout).toBe('brief-on-stdin');
    expect(result.promptFile).toBeUndefined();
  });

  it('reads {result_file} after exit, bounded, and deletes the file', async () => {
    const result = await runHeadless('/bin/cp {prompt_file} {result_file}', 'x'.repeat(4096), {
      cwd: makeTempDir('plandesk-headless-'),
      timeoutMs: 10_000,
      maxResultBytes: 1024,
    });

    expect(result.reason).toBe('exited');
    expect(result.result).toBe('x'.repeat(1024));
    expect(result.resultTruncated).toBe(true);
    expect(result.resultFile).toBeDefined();
    expect(existsSync(result.resultFile ?? '/')).toBe(false); // read, then deleted
  });

  it('returns the whole result file when it fits the cap', async () => {
    const result = await runHeadless('/bin/cp {prompt_file} {result_file}', 'ok-result', {
      cwd: makeTempDir('plandesk-headless-'),
      timeoutMs: 10_000,
    });

    expect(result.result).toBe('ok-result');
    expect(result.resultTruncated).toBe(false);
  });

  it('tolerates a worker that never writes its result file', async () => {
    const result = await runHeadless('/bin/echo {result_file}', 'ignored', {
      cwd: makeTempDir('plandesk-headless-'),
      timeoutMs: 10_000,
    });

    expect(result.reason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.result).toBe('');
    expect(result.resultTruncated).toBe(false);
    expect(existsSync(result.resultFile ?? '/')).toBe(false);
  });

  it('passes the timeout through: a stuck worker resolves reason timeout', async () => {
    const result = await runHeadless('/bin/sleep 10', 'ignored', {
      cwd: makeTempDir('plandesk-headless-'),
      timeoutMs: 300,
    });

    expect(result.reason).toBe('timeout');
    expect(result.durationMs).toBeLessThan(5000);
  });
});
