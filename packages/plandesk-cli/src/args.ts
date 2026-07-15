import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_PORT = 3847;
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
 * Resolve the data directory for commands that read an existing workspace
 * (serve, token, export, import, etc.).
 * Priority: explicit override → PLANDESK_DATA_DIR env → nearest .plandesk/ walking
 * up from startDir (defaults to cwd) → ~/.plandesk global fallback.
 */
export function resolveDataDir(override?: string, startDir?: string): string {
  if (override !== undefined) {
    return override;
  }
  const fromEnv = process.env['PLANDESK_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  const local = findLocalPlandeskDir(startDir ?? process.cwd());
  if (local !== undefined) {
    return local;
  }
  return defaultDataDir();
}

/**
 * Resolve the data directory for `plandesk init`, which always creates locally
 * in the current directory rather than walking up or falling back to ~/.plandesk.
 * Priority: explicit override → PLANDESK_DATA_DIR env → .plandesk/ in cwd.
 */
export function resolveInitDataDir(override?: string): string {
  if (override !== undefined) {
    return override;
  }
  const fromEnv = process.env['PLANDESK_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return join(process.cwd(), PLANDESK_DIR);
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
  'serve',
  'url',
  'token',
  'export',
  'import',
  'connect',
  'disconnect',
  'doctor',
  'push',
  'pull',
  'share',
  'deploy',
  'factory',
  'context',
  'progress-checkpoint',
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
  | { command: 'init'; dataDir?: string }
  | { command: 'serve'; port?: number; dataDir?: string; host?: string; strictPort: boolean }
  | { command: 'url'; repoDir?: string; lan: boolean }
  | { command: 'token'; subcommand: 'create'; name: string; dataDir?: string }
  | { command: 'export'; projectId: string; outPath: string; dataDir?: string }
  | { command: 'import'; inPath: string; dataDir?: string }
  | {
      command: 'connect';
      repoDir?: string;
      project?: string;
      url?: string;
      token?: string;
      agent: ConnectAgent;
      print: boolean;
    }
  | { command: 'disconnect'; repoDir?: string }
  | { command: 'doctor'; dataDir?: string; repoDir?: string }
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
    return { command: 'init', dataDir };
  }

  if (command === 'serve') {
    return {
      command: 'serve',
      port: parsePort(flagString(flags, 'port')),
      dataDir,
      host: flagString(flags, 'host'),
      strictPort: flags['strict-port'] === true,
    };
  }

  if (command === 'url') {
    return { command: 'url', repoDir: flagString(flags, 'repo'), lan: flags['lan'] === true };
  }

  if (command === 'token') {
    const subcommand = positional[1];
    if (subcommand === 'create') {
      const name = flagString(flags, 'name');
      if (name === undefined || name.trim() === '') {
        return { command: 'unknown', name: 'token create (missing --name)' };
      }
      return { command: 'token', subcommand: 'create', name, dataDir };
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
      url: flagString(flags, 'url'),
      token: flagString(flags, 'token'),
      agent,
      print: flags['print'] === true,
    };
  }

  if (command === 'disconnect') {
    return { command: 'disconnect', repoDir: flagString(flags, 'repo') };
  }

  if (command === 'doctor') {
    return { command: 'doctor', dataDir, repoDir: flagString(flags, 'repo') };
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
  plandesk init [--data-dir <dir>]
  plandesk serve [--port <n>] [--strict-port] [--host <addr>] [--data-dir <dir>]
  plandesk url [--repo <dir>] [--lan]
  plandesk token create --name <name> [--data-dir <dir>]
  plandesk export --project <id> --out <file.json> [--data-dir <dir>]
  plandesk import --in <file.json> [--data-dir <dir>]
  plandesk connect [--repo <dir>] [--project <id|name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
  plandesk disconnect [--repo <dir>]
  plandesk doctor [--data-dir <dir>] [--repo <dir>]
  plandesk push [--project <id>] [--to <orgId>] [--url <server>] [--repo <dir>] [--data-dir <dir>]
  plandesk pull [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk share create --audience <name> [--public] [--invite <email[,email]>] [--allow-submit] [--expires <30d>] [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk deploy [target]   # list deploy guides, or print one for your coding agent: plandesk deploy cloudflare | claude
  plandesk factory init [--repo <dir>] [--print] [--force]
  plandesk factory sync [--write] [--force] [--repo <dir>]   # update scaffolded policy to the latest shipped version
  plandesk context --json [--repo <dir>]   # bound project's current task/doc/progress, for session hooks
  plandesk progress-checkpoint [--message <text>] [--repo <dir>]   # post a checkpoint to the running agent run, for Stop/PreCompact hooks
  plandesk onboard           # teach-me guide: how to work in a Plan Desk + Factory repo
  plandesk version           # print the installed CLI version (also: --version)

Options:
  --data-dir  Workspace directory (default: nearest .plandesk/ walking up from cwd, then PLANDESK_DATA_DIR, then ~/.plandesk)
  --repo      Target repository directory (default: cwd)
  --port      HTTP port for serve (default: workspace.json port → ${String(DEFAULT_PORT)}; auto-rotates if busy)
  --strict-port  Fail instead of rotating when the serve port is in use
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
  --to        Hosted org id for push promote (one-way: export → import into org)
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
  plandesk init && plandesk serve            # UI at $(plandesk url) — init assigns this project a port in
                                             # 3400–3499; legacy workspaces without one fall back to 3847
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
