import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_PORT = 7526;
// Loopback by default: a single-user local tool must not expose its token-gated
// API to the whole LAN silently. LAN use is an explicit opt-in via --host or
// PLANDESK_HOST (issue #5).
export const DEFAULT_BIND_HOST = '127.0.0.1';
export const WORKSPACE_DB = 'workspace.db';
export const PLANDESK_DIR = '.plandesk';

export function defaultDataDir(): string {
  return join(homedir(), PLANDESK_DIR);
}

export function workspaceDbPath(dataDir: string): string {
  return join(dataDir, WORKSPACE_DB);
}

/**
 * Walk up from startDir looking for a .plandesk/ directory.
 * Returns the first one found, or undefined if none exists in the tree.
 * Used for connect bindings / token / url — not for the workspace database.
 */
export function findLocalPlandeskDir(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, PLANDESK_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Walk up from startDir looking for an explicitly created repo-local workspace
 * (a .plandesk/ directory that already contains workspace.db). Connect-only
 * .plandesk/ dirs (config + token, no db) do not count — those fall through to
 * the global board.
 */
export function findLocalWorkspaceDir(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, PLANDESK_DIR);
    if (existsSync(workspaceDbPath(candidate))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolve the data directory for commands that read an existing workspace
 * (serve, token, export, import, etc.).
 * Priority: explicit override → PLANDESK_DATA_DIR env → nearest repo-local
 * workspace.db walking up from startDir (defaults to cwd) → ~/.plandesk.
 */
export function resolveDataDir(override?: string, startDir?: string): string {
  if (override !== undefined) {
    return override;
  }
  const fromEnv = process.env['PLANDESK_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  const local = findLocalWorkspaceDir(startDir ?? process.cwd());
  if (local !== undefined) {
    return local;
  }
  return defaultDataDir();
}

/**
 * Resolve the data directory for `plandesk init`.
 * Default is the machine-global board (~/.plandesk). Pass localDb=true
 * (`--local-db`) for an opt-in repo-local workspace at ./.plandesk.
 * Priority: explicit override → PLANDESK_DATA_DIR env → local or global.
 */
export function resolveInitDataDir(override?: string, localDb = false): string {
  if (override !== undefined) {
    return override;
  }
  const fromEnv = process.env['PLANDESK_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  if (localDb) {
    return join(process.cwd(), PLANDESK_DIR);
  }
  return defaultDataDir();
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

export function resolveBindHost(flagHost?: string): string {
  if (flagHost !== undefined && flagHost.trim() !== '') {
    return flagHost.trim();
  }
  const fromEnv = process.env['PLANDESK_HOST'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  return DEFAULT_BIND_HOST;
}

export function resolveAuthPassword(): string | undefined {
  const password = process.env['PLANDESK_AUTH_PASSWORD'];
  if (password === undefined || password.length === 0) {
    return undefined;
  }
  return password;
}

export type ConnectAgent = 'claude' | 'codex' | 'both' | 'detect';

/** File extensions the previewer/annotator can open. */
export const PREVIEW_EXTENSIONS = ['.md', '.markdown', '.html', '.htm'] as const;

/**
 * Reserved subcommand names. A first positional that is none of these AND is an
 * existing previewable file routes to `preview` (so `plandesk *.md` works).
 */
const RESERVED_COMMANDS = new Set([
  'init',
  'login',
  'logout',
  'whoami',
  'serve',
  'url',
  'token',
  'admin',
  'export',
  'import',
  'legacy-upgrade',
  'go-online',
  'connect',
  'disconnect',
  'doctor',
  'push',
  'pull',
  'share',
  'deploy',
  'factory',
  'workspace',
  'context',
  'progress-checkpoint',
  'migrate',
  'help',
  'onboard',
  'version',
  'open',
  'preview',
  'annotate',
]);

export function hasPreviewExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return PREVIEW_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A previewable target is an existing file with a supported extension. */
export function isPreviewableFile(path: string): boolean {
  return hasPreviewExtension(path) && existsSync(path);
}

export type ParsedArgs =
  | { command: 'login'; server?: string }
  | { command: 'logout' }
  | { command: 'whoami' }
  | { command: 'init'; dataDir?: string; localDb: boolean }
  | { command: 'serve'; port?: number; dataDir?: string; host?: string; strictPort: boolean; configPath?: string }
  | { command: 'url'; repoDir?: string; lan: boolean }
  | {
      command: 'admin';
      subcommand: 'invite-owner';
      email: string;
      dataDir?: string;
      /** Remote Turso/libSQL URL — when set, opens remote DB instead of local workspace. */
      dbUrl?: string;
      dbToken?: string;
      /** better-auth secret for remote (or set PLANDESK_BETTER_AUTH_SECRET). */
      secret?: string;
    }
  | { command: 'export'; projectId: string; outPath: string; dataDir?: string }
  | { command: 'import'; inPath: string; dataDir?: string }
  | { command: 'legacy-upgrade'; from?: string; dataDir?: string; intoWorkspace?: string | true }
  | {
      command: 'go-online';
      dataDir?: string;
      to?: string;
      server?: string;
      token?: string;
      all: boolean;
      workspaces: string[];
    }
  | {
      command: 'connect';
      repoDir?: string;
      project?: string;
      workspace?: string;
      url?: string;
      token?: string;
      agent: ConnectAgent;
      print: boolean;
      /** Hosted org id — mint a scoped agent key (BA4b-3). */
      to?: string;
    }
  | { command: 'disconnect'; repoDir?: string }
  | { command: 'doctor'; dataDir?: string; repoDir?: string; configPath?: string }
  | {
      command: 'migrate';
      dbUrl?: string;
      dbToken?: string;
      dataDir?: string;
      configPath?: string;
    }
  | {
      command: 'push';
      repoDir?: string;
      projectId?: string;
      dataDir?: string;
      toOrgId?: string;
      remoteUrl?: string;
    }
  | { command: 'pull'; repoDir?: string; projectId?: string; dataDir?: string }
  | {
      command: 'share';
      subcommand: 'create';
      audience: string;
      public: boolean;
      invite?: string;
      expires?: string;
      allowSubmit: boolean;
      repoDir?: string;
      projectId?: string;
      dataDir?: string;
    }
  | { command: 'deploy'; target?: string }
  | { command: 'factory'; subcommand: 'init'; repoDir?: string; print: boolean; force: boolean }
  | { command: 'factory'; subcommand: 'sync'; repoDir?: string; write: boolean; force: boolean }
  | { command: 'workspace'; subcommand: 'create' | 'list'; repoDir?: string; name?: string; to?: string }
  | { command: 'context'; repoDir?: string }
  | { command: 'progress-checkpoint'; message?: string; repoDir?: string }
  | { command: 'preview'; paths: string[]; port?: number; host?: string; open: boolean }
  | { command: 'help'; full: boolean }
  | { command: 'onboard' }
  | { command: 'version' }
  | { command: 'unknown'; name: string };

function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

/** Collect every value following a repeated `--<key>` flag (e.g. --workspace a --workspace b). */
function collectRepeatedFlags(args: string[], key: string): string[] {
  const flagName = `--${key}`;
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === flagName) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        out.push(next);
        i++;
      }
    } else if (arg.startsWith(`${flagName}=`)) {
      out.push(arg.slice(flagName.length + 1));
    }
  }
  return out;
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return undefined;
  }
  return port;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const { positional, flags } = parseFlags(argv.slice(2));
  const command = positional[0];

  if (command === 'version' || flags['version'] === true) {
    return { command: 'version' };
  }

  if (command === 'onboard') {
    return { command: 'onboard' };
  }

  if (
    command === undefined ||
    command === 'help' ||
    command === '--help' ||
    flags['help'] === true
  ) {
    return { command: 'help', full: flags['commands'] === true || flags['full'] === true };
  }

  const dataDir = flagString(flags, 'data-dir');

  // Explicit previewer: `plandesk open|preview|annotate <paths...>`.
  if (command === 'open' || command === 'preview' || command === 'annotate') {
    return {
      command: 'preview',
      paths: positional.slice(1),
      port: parsePort(flagString(flags, 'port')),
      host: flagString(flags, 'host'),
      open: flags['no-open'] !== true,
    };
  }

  // Bare-file sugar: `plandesk report.md` / `plandesk *.md`. Only when the first
  // positional is not a reserved subcommand and resolves to a previewable file,
  // so a file named like a subcommand can never be shadowed silently.
  if (!RESERVED_COMMANDS.has(command) && isPreviewableFile(command)) {
    return {
      command: 'preview',
      paths: positional.filter(hasPreviewExtension),
      port: parsePort(flagString(flags, 'port')),
      host: flagString(flags, 'host'),
      open: flags['no-open'] !== true,
    };
  }

  if (command === 'init') {
    return { command: 'init', dataDir, localDb: flags['local-db'] === true };
  }

  if (command === 'login') return { command: 'login', server: flagString(flags, 'server') };
  if (command === 'logout') return { command: 'logout' };
  if (command === 'whoami') return { command: 'whoami' };

  if (command === 'serve') {
    return {
      command: 'serve',
      port: parsePort(flagString(flags, 'port')),
      dataDir,
      host: flagString(flags, 'host'),
      strictPort: flags['strict-port'] === true,
      configPath: flagString(flags, 'config'),
    };
  }

  if (command === 'url') {
    return { command: 'url', repoDir: flagString(flags, 'repo'), lan: flags['lan'] === true };
  }

  if (command === 'admin') {
    const subcommand = positional[1];
    if (subcommand === 'invite-owner') {
      const email = flagString(flags, 'email');
      if (email === undefined || email.trim() === '') {
        return { command: 'unknown', name: 'admin invite-owner (missing --email)' };
      }
      return {
        command: 'admin',
        subcommand: 'invite-owner',
        email,
        dataDir,
        dbUrl: flagString(flags, 'db'),
        dbToken: flagString(flags, 'db-token'),
        secret: flagString(flags, 'secret'),
      };
    }
    return { command: 'unknown', name: command };
  }

  if (command === 'export') {
    const projectId = flagString(flags, 'project');
    const outPath = flagString(flags, 'out');
    if (projectId === undefined || projectId.trim() === '') {
      return { command: 'unknown', name: 'export (missing --project)' };
    }
    if (outPath === undefined || outPath.trim() === '') {
      return { command: 'unknown', name: 'export (missing --out)' };
    }
    return { command: 'export', projectId, outPath, dataDir };
  }

  if (command === 'import') {
    const inPath = flagString(flags, 'in');
    if (inPath === undefined || inPath.trim() === '') {
      return { command: 'unknown', name: 'import (missing --in)' };
    }
    return { command: 'import', inPath, dataDir };
  }

  if (command === 'legacy-upgrade') {
    const intoWorkspaceRaw = flags['into-workspace'];
    return {
      command: 'legacy-upgrade',
      from: flagString(flags, 'from'),
      dataDir,
      intoWorkspace: typeof intoWorkspaceRaw === 'string' ? intoWorkspaceRaw : intoWorkspaceRaw === true ? true : undefined,
    };
  }

  if (command === 'go-online') {
    return {
      command: 'go-online',
      dataDir,
      to: flagString(flags, 'to'),
      server: flagString(flags, 'server'),
      token: flagString(flags, 'token'),
      all: flags['all'] === true,
      workspaces: collectRepeatedFlags(argv.slice(2), 'workspace'),
    };
  }

  if (command === 'connect') {
    const agentRaw = flagString(flags, 'agent') ?? 'detect';
    const agent =
      agentRaw === 'claude' || agentRaw === 'codex' || agentRaw === 'both' || agentRaw === 'detect'
        ? agentRaw
        : 'detect';
    return {
      command: 'connect',
      repoDir: flagString(flags, 'repo'),
      project: flagString(flags, 'project'),
      workspace: flagString(flags, 'workspace'),
      url: flagString(flags, 'url'),
      token: flagString(flags, 'token'),
      agent,
      print: flags['print'] === true,
      to: flagString(flags, 'to'),
    };
  }

  if (command === 'disconnect') {
    return { command: 'disconnect', repoDir: flagString(flags, 'repo') };
  }

  if (command === 'doctor') {
    return {
      command: 'doctor',
      dataDir,
      repoDir: flagString(flags, 'repo'),
      configPath: flagString(flags, 'config'),
    };
  }

  if (command === 'migrate') {
    return {
      command: 'migrate',
      dbUrl: flagString(flags, 'db'),
      dbToken: flagString(flags, 'db-token'),
      dataDir,
      configPath: flagString(flags, 'config'),
    };
  }

  if (command === 'push') {
    return {
      command: 'push',
      repoDir: flagString(flags, 'repo'),
      projectId: flagString(flags, 'project'),
      dataDir,
      toOrgId: flagString(flags, 'to'),
      remoteUrl: flagString(flags, 'remote') ?? flagString(flags, 'url'),
    };
  }

  if (command === 'pull') {
    return {
      command: 'pull',
      repoDir: flagString(flags, 'repo'),
      projectId: flagString(flags, 'project'),
      dataDir,
    };
  }

  if (command === 'share') {
    const subcommand = positional[1];
    if (subcommand === 'create') {
      const audience = flagString(flags, 'audience');
      if (audience === undefined || audience.trim() === '') {
        return { command: 'unknown', name: 'share create (missing --audience)' };
      }
      return {
        command: 'share',
        subcommand: 'create',
        audience,
        public: flags['public'] === true,
        invite: flagString(flags, 'invite'),
        expires: flagString(flags, 'expires'),
        allowSubmit: flags['allow-submit'] === true,
        repoDir: flagString(flags, 'repo'),
        projectId: flagString(flags, 'project'),
        dataDir,
      };
    }
    return { command: 'unknown', name: 'share' };
  }

  if (command === 'deploy') {
    return { command: 'deploy', target: positional[1] };
  }

  if (command === 'factory') {
    const subcommand = positional[1];
    if (subcommand === 'init') {
      return {
        command: 'factory',
        subcommand: 'init',
        repoDir: flagString(flags, 'repo'),
        print: flags['print'] === true,
        force: flags['force'] === true,
      };
    }
    if (subcommand === 'sync') {
      return {
        command: 'factory',
        subcommand: 'sync',
        repoDir: flagString(flags, 'repo'),
        write: flags['write'] === true,
        force: flags['force'] === true,
      };
    }
    return { command: 'unknown', name: 'factory' };
  }

  if (command === 'workspace') {
    const subcommand = positional[1];
    if (subcommand === 'create') {
      return {
        command: 'workspace',
        subcommand: 'create',
        repoDir: flagString(flags, 'repo'),
        name: positional[2],
        to: flagString(flags, 'to'),
      };
    }
    if (subcommand === 'list') {
      return {
        command: 'workspace',
        subcommand: 'list',
        repoDir: flagString(flags, 'repo'),
        to: flagString(flags, 'to'),
      };
    }
    return { command: 'unknown', name: 'workspace' };
  }

  if (command === 'context') {
    return { command: 'context', repoDir: flagString(flags, 'repo') };
  }

  if (command === 'progress-checkpoint') {
    return {
      command: 'progress-checkpoint',
      message: flagString(flags, 'message'),
      repoDir: flagString(flags, 'repo'),
    };
  }

  return { command: 'unknown', name: command };
}

export function usage(): string {
  return `plandesk — Plan Desk workspace CLI

Usage:
  plandesk <file.md|file.html> [more…]       # preview & annotate files in the browser (glob-friendly)
  plandesk open <paths…> [--port <n>] [--host <addr>] [--no-open]   # explicit previewer
  plandesk init [--data-dir <dir>] [--local-db]
  plandesk login [--server <url>]
  plandesk logout
  plandesk whoami
  plandesk serve [--port <n>] [--strict-port] [--host <addr>] [--data-dir <dir>] [--config <file>]
  plandesk url [--repo <dir>] [--lan]
  plandesk admin invite-owner --email <email> [--data-dir <dir>]  # self-host first owner (no GitHub)
  plandesk admin invite-owner --email <email> --db <url> [--db-token <t>] [--secret <s>]  # remote Turso bootstrap (secret or PLANDESK_BETTER_AUTH_SECRET)
  plandesk export --project <id> --out <file.json> [--data-dir <dir>]
  plandesk import --in <file.json> [--data-dir <dir>]
  plandesk legacy-upgrade [--from <old-workspace.db>] [--data-dir <dir>]   # lift a 0.20.0-era board into the global board
  plandesk go-online [--to <orgId>] [--server <url>] [--token <key>] [--all | --workspace <name>...]   # push local workspaces + projects up to a hosted org (requires plandesk login)
  plandesk connect [--repo <dir>] [--project <id|name>] [--workspace <name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
  plandesk connect --to <orgId> [--project <id|name>] [--workspace <name>] [--repo <dir>] [--print]   # hosted: mint scoped agent key (requires plandesk login)
  plandesk disconnect [--repo <dir>]
  plandesk doctor [--data-dir <dir>] [--repo <dir>] [--config <file>]
  plandesk migrate --db <url> [--db-token <token>] [--config <file>] [--data-dir <dir>]   # apply schema migrations to a remote (self-host) database
  plandesk push [--project <id>] [--to <orgId>] [--url <server>] [--repo <dir>] [--data-dir <dir>]
  plandesk pull [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk share create --audience <name> [--public] [--invite <email[,email]>] [--allow-submit] [--expires <30d>] [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk deploy [target]   # list deploy guides, or print one for your coding agent: plandesk deploy cloudflare | claude
  plandesk factory init [--repo <dir>] [--print] [--force]
  plandesk factory sync [--write] [--force] [--repo <dir>]   # update scaffolded policy to the latest shipped version
  plandesk workspace create <name> [--to <orgId>]
  plandesk workspace list [--to <orgId>]
  plandesk context --json [--repo <dir>]   # bound project's current task/doc/progress, for session hooks
  plandesk progress-checkpoint [--message <text>] [--repo <dir>]   # post a checkpoint to the running agent run, for Stop/PreCompact hooks
  plandesk onboard           # teach-me guide: how to work in a Plan Desk + Factory repo
  plandesk version           # print the installed CLI version (also: --version)

Options:
  --data-dir  Workspace directory (default: PLANDESK_DATA_DIR, else nearest repo-local workspace.db, else ~/.plandesk)
  --local-db  (init) create a repo-local .plandesk/workspace.db instead of the global board
  --repo      Target repository directory (default: cwd)
  --port      HTTP port for serve (default: workspace.json port → ${String(DEFAULT_PORT)})
  --strict-port  Fail when the serve port is in use (always the case — one global board, one port)
  --config   Server config file (plandesk.server.json) — env still overrides (default: <data-dir>/plandesk.server.json)
  --lan       (url) print the LAN-accessible URL instead of loopback
  --host      Bind address (default: 127.0.0.1 — loopback only; opt into LAN with --host 0.0.0.0 or PLANDESK_HOST)
  --project   Project id or name for connect/export
  --url       Plan Desk server URL for connect (default: http://127.0.0.1:${String(DEFAULT_PORT)})
  --token     MCP token for connect
  --agent     Agent config target for connect (default: detect)
  --print     Dry-run connect / factory init without writing files
  --write     (factory sync) apply creates + safe updates (customized files are kept)
  --force     (factory init) scaffold even in a global config dir; (factory sync) also overwrite customized files
  --out       Output file for export
  --in        Input file for import
  --from      (legacy-upgrade) path to an old workspace.db (default: ~/.plandesk/workspace.db or ./.plandesk/workspace.db)
  --to        Hosted org id: connect mints a scoped agent key; push promotes into this org
  --message   (progress-checkpoint) checkpoint text (default: "checkpoint (hook)")
`;
}

export function crashCourse(): string {
  return `plandesk — local-first planning for you and your coding agent

WHAT IT IS
  A graph of tasks (dependency edges + specs) you run on your own machine. You and
  your agent read and write the same plan over MCP; every change is live. You can
  optionally share a read-only, live view of a plan with a client or another team.

GET STARTED
  npm i -g @plandesk/cli
  plandesk init && plandesk serve            # global board at ~/.plandesk; UI at $(plandesk url)
                                             # (default port ${String(DEFAULT_PORT)}; one board per machine)
  Then, from your project folder, paste into Claude Code or Codex:
    Read https://plandesk.asyncdot.com/start.md then set up Plan Desk for this project.

THE CORE LOOP  (you + your agent)
  plandesk connect --project "<name>"        # bind this repo to a project
  agent: scaffold_project_from_plan → loop get_next_task → update_task → done
  Steer by commenting on docs; the agent reads and resolves them. All live.

RUN IT WITH YOUR AGENT  (optional — delegated, lane-gated execution)
  plandesk factory init                      # scaffold .agents/factory + curator skills
  plandesk onboard                           # teach-me: how to work in a Plan Desk + Factory repo
  Your agent then runs the board unattended: pull get_next_task → dispatch a worker CLI →
  verify → done, gated by risk lanes. Curator skills triage raw signal into tasks and
  scaffold plans onto the board. Read .agents/index.md after init.

SHARE WITH YOUR TEAM  (optional)
  plandesk deploy cloudflare | claude        # agent stands up your sync server
  plandesk share create --audience "Acme" --public --allow-submit
  plandesk push --to <orgId>                   # promote the project to your hosted org; the portal reads it live

READ THESE  (.md — fetchable by humans and agents; read before you act)
  Setup, paste-and-go ....... https://plandesk.asyncdot.com/start.md
  Start with just an idea ... https://plandesk.asyncdot.com/guides/start-with-an-idea.md
  Hands-on build loop ....... https://plandesk.asyncdot.com/guides/idea-to-development.md
  Share with a team ......... https://plandesk.asyncdot.com/guides/plan-share-build.md
  Every command + flag ...... https://plandesk.asyncdot.com/reference/cli.md
  Architecture + security ... https://plandesk.asyncdot.com/reference/collaboration.md
  Upgrade an old setup ...... https://plandesk.asyncdot.com/reference/upgrading.md
  Fix a problem ............. https://plandesk.asyncdot.com/reference/troubleshooting.md
  Everything, one file ...... https://plandesk.asyncdot.com/llms-full.txt

  Agents: fetch the links above to learn the conventions before changing a plan.
  Full command grammar: plandesk help --commands
`;
}
