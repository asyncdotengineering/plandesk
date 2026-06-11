import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 3847;
export const DEFAULT_BIND_HOST = '127.0.0.1';
export const WORKSPACE_DB = 'workspace.db';

export function defaultDataDir(): string {
  return join(homedir(), '.plandesk');
}

export function workspaceDbPath(dataDir: string): string {
  return join(dataDir, WORKSPACE_DB);
}

export function resolveDataDir(override?: string): string {
  if (override !== undefined) {
    return override;
  }
  const fromEnv = process.env['PLANDESK_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
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

export type ParsedArgs =
  | { command: 'init'; dataDir?: string }
  | { command: 'serve'; port: number; dataDir?: string; host?: string; strictPort: boolean }
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
      command: 'publish';
      repoDir?: string;
      projectId?: string;
      remoteUrl: string;
      syncToken?: string;
      dataDir?: string;
    }
  | { command: 'push'; repoDir?: string; projectId?: string; dataDir?: string }
  | { command: 'pull'; repoDir?: string; projectId?: string; dataDir?: string }
  | { command: 'sync'; watch: boolean; repoDir?: string; projectId?: string; dataDir?: string }
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
  | { command: 'help'; full: boolean }
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

  if (
    command === undefined ||
    command === 'help' ||
    command === '--help' ||
    flags['help'] === true
  ) {
    return { command: 'help', full: flags['commands'] === true || flags['full'] === true };
  }

  const dataDir = flagString(flags, 'data-dir');

  if (command === 'init') {
    return { command: 'init', dataDir };
  }

  if (command === 'serve') {
    const port = parsePort(flagString(flags, 'port')) ?? DEFAULT_PORT;
    return {
      command: 'serve',
      port,
      dataDir,
      host: flagString(flags, 'host'),
      strictPort: flags['strict-port'] === true,
    };
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

  if (command === 'publish') {
    const remoteUrl = flagString(flags, 'remote');
    if (remoteUrl === undefined || remoteUrl.trim() === '') {
      return { command: 'unknown', name: 'publish (missing --remote)' };
    }
    return {
      command: 'publish',
      repoDir: flagString(flags, 'repo'),
      projectId: flagString(flags, 'project'),
      remoteUrl,
      syncToken: flagString(flags, 'sync-token'),
      dataDir,
    };
  }

  if (command === 'push') {
    return {
      command: 'push',
      repoDir: flagString(flags, 'repo'),
      projectId: flagString(flags, 'project'),
      dataDir,
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

  if (command === 'sync') {
    return {
      command: 'sync',
      watch: flags['watch'] === true,
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

  return { command: 'unknown', name: command };
}

export function usage(): string {
  return `plandesk — Plan Desk workspace CLI

Usage:
  plandesk init [--data-dir <dir>]
  plandesk serve [--port ${String(DEFAULT_PORT)}] [--strict-port] [--host <addr>] [--data-dir <dir>]
  plandesk token create --name <name> [--data-dir <dir>]
  plandesk export --project <id> --out <file.json> [--data-dir <dir>]
  plandesk import --in <file.json> [--data-dir <dir>]
  plandesk connect [--repo <dir>] [--project <id|name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
  plandesk disconnect [--repo <dir>]
  plandesk doctor [--data-dir <dir>] [--repo <dir>]
  plandesk publish --remote <url> [--project <id>] [--sync-token <t>] [--repo <dir>] [--data-dir <dir>]
  plandesk push [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk pull [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk sync --watch [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk share create --audience <name> [--public] [--invite <email[,email]>] [--allow-submit] [--expires <30d>] [--project <id>] [--repo <dir>] [--data-dir <dir>]
  plandesk deploy [target]   # list deploy guides, or print one for your coding agent: plandesk deploy cloudflare | claude
  plandesk version           # print the installed CLI version (also: --version)

Options:
  --data-dir  Workspace directory (default: ~/.plandesk, or PLANDESK_DATA_DIR)
  --repo      Target repository directory (default: cwd)
  --port      HTTP port for serve (default: ${String(DEFAULT_PORT)}; auto-rotates if busy)
  --strict-port  Fail instead of rotating when the serve port is in use
  --host      Bind address (default: 127.0.0.1, or PLANDESK_HOST)
  --project   Project id or name for connect/export
  --url       Plan Desk server URL for connect (default: http://127.0.0.1:${String(DEFAULT_PORT)})
  --token     MCP token for connect
  --agent     Agent config target for connect (default: detect)
  --print     Dry-run connect without writing files
  --out       Output file for export
  --in        Input file for import
  --remote    Sync server URL for publish
  --sync-token  Sync token for publish (default: PLANDESK_SYNC_TOKEN or .plandesk/sync-token)
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
  plandesk init && plandesk serve            # UI at http://127.0.0.1:${String(DEFAULT_PORT)}
  Then, from your project folder, paste into Claude Code or Codex:
    Read https://plandesk.asyncdot.com/start.md then set up Plan Desk for this project.

THE CORE LOOP  (you + your agent)
  plandesk connect --project "<name>"        # bind this repo to a project
  agent: scaffold_project_from_plan → loop get_next_task → update_task → done
  Steer by commenting on docs; the agent reads and resolves them. All live.

SHARE WITH YOUR TEAM  (optional)
  plandesk deploy cloudflare | claude        # agent stands up your sync server
  plandesk share create --audience "Acme" --public --allow-submit
  plandesk push                              # they watch live + file issues; you triage

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
