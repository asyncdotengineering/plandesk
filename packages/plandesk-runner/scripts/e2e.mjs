#!/usr/bin/env node
/**
 * End-to-end proof that the runner moves a real task on a real board.
 *
 * Unit tests assert every module against stubs. This asserts the whole
 * pipeline against a live board and a live worker: poll, claim, brief,
 * dispatch, gate, settle. A green unit suite never proves this.
 *
 *   node scripts/e2e.mjs [--path=happy|failure|park|approve] [--config <path>]
 *
 * The scratch repository is served over `git://` from a local `git daemon`,
 * because the board's repo_url allowlist rejects `file:` on purpose.
 *
 * Exits 0 with an explicit skip message when the board is unreachable — never
 * a silent pass.
 */

import { execFile, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse as parseToml } from 'smol-toml';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_BIN = join(HERE, '..', 'bin', 'plandesk-runner');

const cleanups = [];
let failures = 0;

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

function assert(condition, message, detail) {
  if (condition) {
    log(`    PASS  ${message}`);
    return true;
  }
  failures += 1;
  log(`    FAIL  ${message}`);
  if (detail !== undefined) {
    log(`          ${detail}`);
  }
  return false;
}

function parseArgs(argv) {
  let only;
  let configPath;
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg.startsWith('--path=')) {
      only = arg.slice('--path='.length);
    } else if (arg === '--path') {
      only = rest.shift();
    } else if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
    } else if (arg === '--config') {
      configPath = rest.shift();
    } else {
      throw new Error(`unrecognised argument: ${arg}`);
    }
  }
  return { only, configPath };
}

function resolveConfigPath(explicit) {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env['PLANDESK_RUNNER_CONFIG'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  return join(homedir(), '.plandesk', 'runner.toml');
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function git(args, cwd) {
  return await execFileAsync('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

/** A bare repository with one commit on `main`, served by a local git daemon. */
async function startScratchRepo() {
  const base = mkdtempSync(join(tmpdir(), 'plandesk-e2e-repo-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));

  const work = join(base, 'work');
  mkdirSync(work, { recursive: true });
  await git(['init', '--initial-branch=main', '.'], work);
  await git(['config', 'user.email', 'e2e@plandesk.invalid'], work);
  await git(['config', 'user.name', 'Plan Desk E2E'], work);
  writeFileSync(join(work, 'README.md'), '# scratch\n\nFixture repository for the runner end-to-end check.\n');

  // Worker resolution is repo-declared by design: the runner reads
  // `.agents/factory/workers` from the WORKTREE, not from wherever it was
  // launched. A fixture repo that ships none has no usable workers, so copy
  // this repository's real declarations in.
  const declaredDir = join(work, '.agents', 'factory', 'workers');
  mkdirSync(declaredDir, { recursive: true });
  const sourceDir = join(HERE, '..', '..', '..', '.agents', 'factory', 'workers');
  for (const entry of readdirSync(sourceDir)) {
    if (entry.endsWith('.md')) {
      copyFileSync(join(sourceDir, entry), join(declaredDir, entry));
    }
  }

  await git(['add', '.'], work);
  await git(['commit', '-m', 'seed the scratch repository'], work);

  const bare = join(base, 'scratch.git');
  await git(['clone', '--bare', work, bare]);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
  writeFileSync(join(bare, 'git-daemon-export-ok'), '');

  const port = await freePort();
  const daemon = spawn(
    'git',
    ['daemon', '--reuseaddr', '--listen=127.0.0.1', `--port=${port}`, `--base-path=${base}`, '--export-all', base],
    { stdio: 'ignore' },
  );
  cleanups.push(() => {
    daemon.kill('SIGTERM');
  });

  const url = `git://127.0.0.1:${port}/scratch.git`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await git(['ls-remote', url]);
      return url;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`git daemon never served ${url}`);
}

function makeBoard(boardUrl, agentKey) {
  const base = `${boardUrl.trim().replace(/\/+$/, '')}/api/v1`;
  return async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(agentKey === '' ? {} : { Authorization: `Bearer ${agentKey}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`board ${method} ${path} → HTTP ${response.status}: ${text.slice(0, 400)}`);
    }
    return text === '' ? undefined : JSON.parse(text);
  };
}

/**
 * Each path pins the one behaviour it exists to prove. The gate command is
 * `true`/`false` on purpose: it isolates the runner's plumbing from whether the
 * worker happened to write good code.
 */
const PATHS = {
  happy: {
    label: 'E2E happy path — auto lane, passing gate',
    lane: 'auto',
    gate: 'true',
    brief: 'Create a file named `e2e-ok.txt` containing exactly `ok`. Change nothing else.',
    expect: { status: 'done', runStatus: 'completed' },
  },
  failure: {
    label: 'E2E failure path — auto lane, failing gate',
    lane: 'auto',
    gate: 'false',
    brief: 'Create a file named `e2e-fail.txt` containing exactly `fail`. Change nothing else.',
    // A failed attempt closes its run as `failed`, not `completed`: the run
    // records what happened, not merely that the runner finished.
    expect: { status: 'todo', runStatus: 'failed' },
  },
  park: {
    label: 'E2E park path — worker asks a question',
    lane: 'auto',
    gate: 'true',
    brief:
      'Do not change any source file. Create the directory `.plandesk` and write a file ' +
      '`.plandesk/NEEDS_INPUT.md` whose entire contents are the single line: ' +
      '`Which database should this use?` Then stop.',
    expect: { status: 'scope', runStatus: 'completed' },
  },
  approve: {
    label: 'E2E gate lane — approve holds for a human',
    lane: 'approve',
    gate: 'true',
    brief: 'Create a file named `e2e-approve.txt` containing exactly `ok`. Change nothing else.',
    expect: { status: 'in_progress', runStatus: 'completed' },
  },
};

function describeTask(spec) {
  return [
    '## Problem',
    '',
    spec.brief,
    '',
    '## Validation contract',
    '',
    '```gate',
    spec.gate,
    '```',
    '',
    '## Non-goals',
    '',
    'This is a fixture for the runner end-to-end check. It proves plumbing, not code quality.',
  ].join('\n');
}

async function runPath(name, spec, ctx) {
  log(`\n  ${name}: ${spec.label}`);
  const task = await ctx.board('POST', `/projects/${ctx.projectId}/tasks`, {
    label: spec.label,
    description: describeTask(spec),
    status: 'todo',
    lane: spec.lane,
  });

  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER_BIN, '--once', '--config', ctx.configPath, '--project', ctx.projectId], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
  const durationMs = Date.now() - started;

  log(`    runner exit=${result.code} duration=${(durationMs / 1000).toFixed(1)}s`);
  const runnerLine = result.stdout.trim().split('\n').pop() ?? '';
  if (runnerLine !== '') log(`    runner said: ${runnerLine}`);
  if (result.stderr.trim() !== '') log(`    stderr: ${result.stderr.trim().slice(0, 300)}`);

  const tasks = await ctx.board('GET', `/projects/${ctx.projectId}/tasks`);
  const after = tasks.find((entry) => entry.id === task.id);
  assert(
    after?.status === spec.expect.status,
    `task status is ${spec.expect.status}`,
    `actual: ${after?.status ?? '<missing>'}`,
  );

  const runs = await ctx.board('GET', `/projects/${ctx.projectId}/agent-runs`);
  const run = runs[0];
  assert(run !== undefined, 'an agent run exists');
  if (run !== undefined) {
    assert(
      run.status === spec.expect.runStatus,
      `agent run is ${spec.expect.runStatus}`,
      `actual: ${run.status}`,
    );
    assert(run.events.length > 0, 'the run carries at least one progress event');
    const messages = run.events.map((event) => event.message).join('\n');
    log(`    progress: ${messages.replace(/\s+/g, ' ').slice(0, 220)}`);
    if (name === 'failure') {
      assert(/gate|exit|fail/i.test(messages), 'the progress event mentions the gate outcome');
    }
    if (name === 'approve') {
      assert(/human|approve|gate/i.test(messages), 'the progress event says it awaits a human');
    }
    if (name === 'park') {
      assert(/database/i.test(messages), "the worker's question reached the run");
    }
  }

  // Park the fixture so the next path's poll cannot claim it.
  if (after?.status !== 'done') {
    await ctx.board('PATCH', `/tasks/${task.id}`, { status: 'backlog' });
  }
  return { name, durationMs, exit: result.code, status: after?.status };
}

async function main() {
  const { only, configPath: explicitConfig } = parseArgs(process.argv.slice(2));
  const configPath = resolveConfigPath(explicitConfig);

  if (!existsSync(configPath)) {
    log(`SKIP: no runner config at ${configPath} — set PLANDESK_RUNNER_CONFIG or pass --config`);
    return 0;
  }
  const raw = parseToml(readFileSync(configPath, 'utf8'));
  const boardUrl = typeof raw['board_url'] === 'string' ? raw['board_url'] : undefined;
  const agentKey =
    typeof raw['agent_key'] === 'string' ? raw['agent_key'].trim() : process.env['PLANDESK_AGENT_KEY'];
  if (boardUrl === undefined || agentKey === undefined) {
    log(`SKIP: ${configPath} is missing board_url or agent_key`);
    return 0;
  }
  try {
    const health = await fetch(`${boardUrl.replace(/\/+$/, '')}/api/v1/health`, { cache: 'no-store' });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (cause) {
    log(`SKIP: board ${boardUrl} is unreachable — ${cause.message}`);
    return 0;
  }

  log('plandesk-runner end-to-end');
  log(`  config: ${configPath}`);
  log(`  board:  ${boardUrl}`);

  const board = makeBoard(boardUrl, agentKey);
  const repoUrl = await startScratchRepo();
  log(`  repo:   ${repoUrl}`);

  // An isolated workdir per run is what makes the check idempotent: no cached
  // clone and no worktree from a previous run can influence this one.
  const workdir = mkdtempSync(join(tmpdir(), 'plandesk-e2e-work-'));
  cleanups.push(() => rmSync(workdir, { recursive: true, force: true }));
  const runConfigPath = join(workdir, 'runner.toml');
  writeFileSync(
    runConfigPath,
    Object.entries({ ...raw, workdir })
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
      .join('\n') + '\n',
  );
  log(`  workdir: ${workdir}`);

  const project = await board('POST', '/projects', {
    name: `runner-e2e ${new Date().toISOString()}`,
    repo_url: repoUrl,
  });
  log(`  project: ${project.id}`);

  const ctx = { board, projectId: project.id, configPath: runConfigPath };
  const selected = only === undefined ? Object.keys(PATHS) : [only];
  for (const name of selected) {
    if (PATHS[name] === undefined) throw new Error(`unknown path: ${name}`);
  }

  const results = [];
  for (const name of selected) {
    results.push(await runPath(name, PATHS[name], ctx));
  }

  log('\nsummary');
  for (const result of results) {
    log(`  ${result.name.padEnd(9)} status=${String(result.status).padEnd(12)} ${(result.durationMs / 1000).toFixed(1)}s`);
  }
  log(failures === 0 ? '\nALL PATHS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
  return failures === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  log(`ERROR: ${error.stack ?? error.message}`);
  code = 1;
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      cleanup();
    } catch {
      // teardown is best-effort; a leaked temp dir must not mask a result
    }
  }
}
process.exit(code);
