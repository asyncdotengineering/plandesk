#!/usr/bin/env node
// Boot each self-host target against a throwaway sqld and prove it serves:
// health with a current schema, an owner key, MCP tools/list, a file
// round-trip, and a 503 `schema_behind` on a stale database with a held lease.
//
//   node scripts/smoke-deploy.mjs <docker|cloudflare|vercel|all>
//
// Env: SMOKE_KEEP=1 keeps containers, processes' dirs and sqld data.
//      SMOKE_DOCKERFILE=<path> builds another Dockerfile (default: ./Dockerfile).
//      SMOKE_SQLD=<path> sqld binary (default: ~/.turso/sqld, then PATH).
// One line per assertion; exits non-zero on the first failure. Child output
// goes to the run log under .agents/factory/runs/.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, appendFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['docker', 'cloudflare', 'vercel'];
const LIVE_PORT = 7526; // the owner's live board — never bind or probe it on the host
const BOOT_TIMEOUT_MS = 120_000;
const STALE_WINDOW_MS = 10_000;
const MIN_MCP_TOOLS = 60;

const target = process.argv[2];
if (!TARGETS.includes(target) && target !== 'all') {
  console.error('usage: node scripts/smoke-deploy.mjs <docker|cloudflare|vercel|all>');
  process.exit(2);
}
const keep = process.env.SMOKE_KEEP === '1';
const SQLD =
  process.env.SMOKE_SQLD ??
  (existsSync(join(homedir(), '.turso/sqld')) ? join(homedir(), '.turso/sqld') : 'sqld');

mkdirSync(join(ROOT, '.agents/factory/runs'), { recursive: true });
const logPath = join(
  ROOT,
  `.agents/factory/runs/smoke-${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
);
const logFd = openSync(logPath, 'a');
const say = (line) => {
  console.log(line);
  appendFileSync(logFd, `${line}\n`);
};

class Fail extends Error {}
function check(name, ok, detail = '') {
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  if (!ok) throw new Fail(name);
}

// --- process + resource bookkeeping -----------------------------------------
const cleanups = [];
function cleanup() {
  if (keep) return say(`SMOKE_KEEP=1: left running/on disk (${cleanups.length} resources)`);
  for (const fn of cleanups.splice(0).reverse()) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `smoke-${prefix}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The run log is evidence that gets shared; keep throwaway credentials out of it.
const logCmd = (cmd, args) =>
  appendFileSync(
    logFd,
    `\n$ ${cmd} ${args.join(' ').replace(/((?:SECRET|PASSWORD)[=:])\S+/g, '$1***')}\n`,
  );

function start(cmd, args, opts = {}) {
  logCmd(cmd, args);
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', logFd, logFd], ...opts });
  proc.on('error', (err) => appendFileSync(logFd, `spawn ${cmd}: ${err.message}\n`));
  cleanups.push(() => proc.exitCode === null && proc.kill('SIGTERM'));
  return proc;
}

function run(cmd, args, opts = {}, { logStdout = true } = {}) {
  logCmd(cmd, args);
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  const out = logStdout ? (res.stdout ?? '') : '<stdout withheld>\n';
  appendFileSync(logFd, `${out}${res.stderr ?? ''}${res.error ? res.error.message : ''}\n`);
  return res;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => (port === LIVE_PORT ? resolve(freePort()) : resolve(port)));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
  } catch {
    return undefined;
  }
}

/** Poll until `url` answers; fail fast if `proc` dies first. */
async function waitForAnswer(url, proc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) return { exited: proc.exitCode };
    const res = await probe(url);
    if (res !== undefined) return { res };
    await sleep(500);
  }
  return {};
}

// Throwaway libSQL server. Docker on Linux reaches the host via the bridge,
// so sqld must listen beyond loopback there.
async function startSqld(forDocker) {
  const port = await freePort();
  const listen = forDocker && process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1';
  const dir = tmp('sqld');
  const proc = start(SQLD, ['--http-listen-addr', `${listen}:${port}`, '-d', join(dir, 'db')]);
  const url = `http://127.0.0.1:${port}`;
  const { res } = await waitForAnswer(`${url}/health`, proc, 15_000);
  check('sqld up', res?.ok === true, url);
  return { url, port };
}

// --- targets ------------------------------------------------------------------
// Each boot(env, dbPort) returns { base, proc }. env holds the PLANDESK_* vars;
// the target maps them onto its platform's config surface.

const docker = {
  prerequisites() {
    const file = process.env.SMOKE_DOCKERFILE ?? 'Dockerfile';
    if (!existsSync(resolve(ROOT, file))) return `${file} (the Docker reference image)`;
    if (run('docker', ['info']).status !== 0) return 'a running docker daemon';
    return undefined;
  },
  built: false,
  async boot(env, dbPort) {
    if (!this.built) {
      const file = process.env.SMOKE_DOCKERFILE ?? 'Dockerfile';
      const res = run('docker', ['build', '-f', file, '-t', 'plandesk:local', '.'], {
        stdio: ['ignore', logFd, logFd],
      });
      check('docker build -t plandesk:local', res.status === 0, `-f ${file}`);
      this.built = true;
    }
    const port = await freePort();
    const name = `plandesk-smoke-${randomBytes(4).toString('hex')}`;
    const base = `http://127.0.0.1:${port}`;
    const vars = {
      ...env,
      PLANDESK_DB_URL: `http://host.docker.internal:${dbPort}`,
      PLANDESK_BASE_URL: base,
    };
    const args = ['run', '--rm', '--name', name, '-p', `127.0.0.1:${port}:${LIVE_PORT}`];
    if (process.platform === 'linux') args.push('--add-host=host.docker.internal:host-gateway');
    for (const [k, v] of Object.entries(vars)) args.push('-e', `${k}=${v}`);
    const proc = start('docker', [...args, 'plandesk:local']);
    cleanups.push(() => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }));
    return { base, proc };
  },
};

const wranglerBin = join(ROOT, 'node_modules/.bin/wrangler');

const cloudflare = {
  prerequisites() {
    if (!existsSync(join(ROOT, 'wrangler.jsonc'))) return './wrangler.jsonc (root Workers config)';
    if (!existsSync(join(ROOT, 'packages/plandesk-server/src/worker.ts')))
      return 'packages/plandesk-server/src/worker.ts (Workers entry)';
    if (!existsSync(wranglerBin)) return 'wrangler (pnpm install)';
    return undefined;
  },
  async boot(env, dbPort) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const vars = { ...env, PLANDESK_DB_URL: `http://127.0.0.1:${dbPort}`, PLANDESK_BASE_URL: base };
    const args = ['dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(port)];
    args.push('--inspector-port', String(await freePort()), '--persist-to', tmp('wrangler'));
    args.push('--show-interactive-dev-session=false');
    for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
    const proc = start(wranglerBin, args, {
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    });
    return { base, proc };
  },
};

const vercel = {
  prerequisites() {
    if (!existsSync(join(ROOT, 'api/index.ts'))) return 'api/index.ts (Vercel function)';
    if (!existsSync(join(ROOT, 'packages/plandesk-server/dist/vercel.js')))
      return 'packages/plandesk-server/dist/vercel.js (run pnpm build)';
    return undefined;
  },
  async boot(env, dbPort) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const proc = start(
      process.execPath,
      ['scripts/smoke/helpers.mjs', 'serve-vercel', String(port)],
      {
        env: {
          ...process.env,
          ...env,
          PLANDESK_DB_URL: `http://127.0.0.1:${dbPort}`,
          PLANDESK_BASE_URL: base,
        },
      },
    );
    return { base, proc };
  },
  // Only meaningful with a logged-in CLI on a linked checkout; skipped otherwise.
  extra() {
    if (run('vercel', ['whoami'], { timeout: 20_000, stdio: 'ignore' }).status !== 0)
      return say('SKIP  vercel build  [vercel CLI missing or not logged in]');
    if (!existsSync(join(ROOT, '.vercel/project.json')))
      return say('SKIP  vercel build  [checkout not linked: run `vercel link`]');
    const out = join(tmp('vercel'), 'output');
    const res = run('vercel', ['build', '--yes', '--output', out], { timeout: 600_000 });
    check('vercel build writes .vercel/output', res.status === 0 && existsSync(out), out);
  },
};

// --- assertions ---------------------------------------------------------------

async function bootAndAnswer(t, env, dbPort) {
  const { base, proc } = await t.boot(env, dbPort);
  const { res, exited } = await waitForAnswer(`${base}/api/v1/health`, proc, BOOT_TIMEOUT_MS);
  const detail =
    exited !== undefined
      ? `target exited with ${exited} before answering; see log`
      : res === undefined
        ? `no answer on ${base} within ${BOOT_TIMEOUT_MS / 1000}s`
        : base;
  check('target answers HTTP', res !== undefined, detail);
  return { base, res };
}

/** Parse a streamable-HTTP MCP reply (plain JSON or one SSE `data:` frame). */
async function mcpBody(res) {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split('\n').find((l) => l.startsWith('data:'));
    return data === undefined ? undefined : JSON.parse(data.slice(5));
  }
  return text === '' ? undefined : JSON.parse(text);
}

async function assertServing(t, env) {
  const db = await startSqld(t === docker);
  const { base } = await bootAndAnswer(t, env, db.port);

  // (a) health green, schema current — the server prepared its own database.
  const health = await probe(`${base}/api/v1/health`);
  const hb = await health?.json().catch(() => undefined);
  check(
    'GET /api/v1/health 200 with schema.current',
    health?.status === 200 && hb?.schema?.current === true,
    `status ${health?.status} schema ${JSON.stringify(hb?.schema ?? null)}`,
  );

  // (b) owner key: the self-hoster's `plandesk admin invite-owner`, then the
  // session that sign-in would give, exchanged at the route `plandesk login` uses.
  const cliHome = tmp('cli');
  const cliEnv = {
    ...process.env,
    HOME: cliHome,
    PLANDESK_DATA_DIR: cliHome,
    PLANDESK_STATE_DIR: cliHome,
    PLANDESK_BETTER_AUTH_SECRET: env.PLANDESK_BETTER_AUTH_SECRET,
  };
  const invite = run(
    process.execPath,
    [
      'packages/plandesk-cli/bin/plandesk',
      'admin',
      'invite-owner',
      '--email',
      'owner@smoke.test',
      '--db',
      db.url,
      '--base-url',
      base,
    ],
    { env: cliEnv },
  );
  check(
    'plandesk admin invite-owner against the target database, claim link on the deployment',
    invite.status === 0 && invite.stdout.includes(`claim link:    ${base}/invite/`),
    `exit ${invite.status}`,
  );
  const cookie = run(
    process.execPath,
    ['scripts/smoke/helpers.mjs', 'owner-cookie', db.url, base],
    { env: cliEnv },
    { logStdout: false },
  );
  check(
    'owner session minted',
    cookie.status === 0 && cookie.stdout !== '',
    `exit ${cookie.status}`,
  );
  // The SPA calls this from a browser that already passed the Basic prompt
  // PLANDESK_AUTH_PASSWORD puts in front of the UI, so it sends both.
  const basic = Buffer.from(`plandesk:${env.PLANDESK_AUTH_PASSWORD}`).toString('base64');
  const tokenRes = await probe(`${base}/api/v1/auth/cli-token`, {
    method: 'POST',
    headers: {
      cookie: cookie.stdout,
      authorization: `Basic ${basic}`,
      origin: base,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'smoke-deploy' }),
  });
  const tb = await tokenRes?.json().catch(() => undefined);
  check(
    'POST /api/v1/auth/cli-token mints an owner key',
    tokenRes?.status === 200 && typeof tb?.token === 'string',
    `status ${tokenRes?.status}`,
  );
  const auth = { authorization: `Bearer ${tb.token}` };

  // (c) MCP tools/list over streamable HTTP.
  const mcpHeaders = {
    ...auth,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const init = await probe(`${base}/mcp/`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke-deploy', version: '1' },
      },
    }),
  });
  check('POST /mcp/ initialize', init?.ok === true, `status ${init?.status}`);
  await init.text();
  const session = init.headers.get('mcp-session-id');
  if (session !== null) {
    mcpHeaders['mcp-session-id'] = session;
    await probe(`${base}/mcp/`, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }
  const list = await probe(`${base}/mcp/`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const lb = list?.ok ? await mcpBody(list).catch(() => undefined) : undefined;
  const tools = lb?.result?.tools?.length ?? 0;
  check(
    `MCP tools/list returns >= ${MIN_MCP_TOOLS} tools`,
    tools >= MIN_MCP_TOOLS,
    `${tools} tools, status ${list?.status}`,
  );

  // (d) file bytes round-trip through storage.
  const pr = await probe(`${base}/api/v1/projects`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke deploy' }),
  });
  const project = await pr?.json().catch(() => undefined);
  check(
    'POST /api/v1/projects',
    pr?.status === 201 && typeof project?.id === 'string',
    `status ${pr?.status}`,
  );
  const bytes = randomBytes(4096);
  const up = await probe(`${base}/api/v1/projects/${project.id}/files`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: 'smoke.bin',
      mime: 'application/octet-stream',
      content_base64: bytes.toString('base64'),
    }),
  });
  const file = await up?.json().catch(() => undefined);
  check(
    'POST /api/v1/projects/:id/files',
    up?.status === 201 && typeof file?.id === 'string',
    `status ${up?.status}`,
  );
  const down = await probe(`${base}/api/v1/files/${file.id}`, { headers: auth });
  const got = down?.ok ? Buffer.from(await down.arrayBuffer()) : Buffer.alloc(0);
  check(
    'GET /api/v1/files/:id returns the uploaded bytes',
    bytes.equals(got),
    `status ${down?.status}, ${got.length}/${bytes.length} bytes`,
  );
}

async function assertStaleRefused(t, env) {
  const db = await startSqld(t === docker);
  const seeded = run(process.execPath, ['scripts/smoke/helpers.mjs', 'stale-db', db.url]);
  check(
    'stale database at migration N-1 with a held lease',
    seeded.status === 0,
    seeded.stdout.trim(),
  );
  const { base, proc } = await t.boot(env, db.port);
  const url = `${base}/api/v1/projects`;
  const { res: first, exited } = await waitForAnswer(url, proc, BOOT_TIMEOUT_MS);
  // The window starts at the first HTTP answer, so image/bundle start-up time
  // doesn't count against it.
  const until = Date.now() + STALE_WINDOW_MS;
  let status;
  let body;
  for (let res = first; res !== undefined; res = await probe(url)) {
    status = res.status;
    body = await res.json().catch(() => undefined);
    if (status === 503 || (status >= 200 && status < 300) || Date.now() > until) break;
    await sleep(500);
  }
  check(
    `stale target answers 503 schema_behind within ${STALE_WINDOW_MS / 1000}s and serves no data`,
    status === 503 && body?.error === 'schema_behind',
    status === undefined
      ? exited !== undefined
        ? `target exited with ${exited}; see log`
        : 'never answered'
      : `status ${status} ${JSON.stringify(body ?? null).slice(0, 160)}`,
  );
}

// --- main ---------------------------------------------------------------------
say(`smoke-deploy ${target} — log: ${logPath}`);
let code = 0;
try {
  for (const name of target === 'all' ? TARGETS : [target]) {
    const t = { docker, cloudflare, vercel }[name];
    say(`== ${name}`);
    const missing = t.prerequisites();
    check(`${name} prerequisites`, missing === undefined, missing && `missing ${missing}`);
    const env = {
      PLANDESK_BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      PLANDESK_AUTH_PASSWORD: randomBytes(16).toString('hex'),
    };
    await assertServing(t, env);
    cleanup();
    await assertStaleRefused(t, env);
    cleanup();
    t.extra?.();
  }
} catch (err) {
  if (!(err instanceof Fail)) say(`FAIL  unexpected error: ${err.stack ?? err}`);
  code = 1;
} finally {
  cleanup();
}
say(`${code === 0 ? 'GREEN' : 'RED'}  log: ${logPath}`);
process.exit(code);
