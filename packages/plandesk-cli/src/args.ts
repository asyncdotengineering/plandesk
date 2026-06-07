import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 3847;
export const BIND_HOST = '127.0.0.1';
export const WORKSPACE_DB = 'workspace.db';

export function defaultDataDir(): string {
  return join(homedir(), '.plandesk');
}

export function workspaceDbPath(dataDir: string): string {
  return join(dataDir, WORKSPACE_DB);
}

export function resolveDataDir(override?: string): string {
  return override ?? defaultDataDir();
}

export type ParsedArgs =
  | { command: 'init'; dataDir?: string }
  | { command: 'serve'; port: number; dataDir?: string }
  | { command: 'token'; subcommand: 'create'; name: string; dataDir?: string }
  | { command: 'help' }
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

  if (
    command === undefined ||
    command === 'help' ||
    command === '--help' ||
    flags['help'] === true
  ) {
    return { command: 'help' };
  }

  const dataDir = flagString(flags, 'data-dir');

  if (command === 'init') {
    return { command: 'init', dataDir };
  }

  if (command === 'serve') {
    const port = parsePort(flagString(flags, 'port')) ?? DEFAULT_PORT;
    return { command: 'serve', port, dataDir };
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

  return { command: 'unknown', name: command };
}

export function usage(): string {
  return `plandesk — Plan Desk workspace CLI

Usage:
  plandesk init [--data-dir <dir>]
  plandesk serve [--port ${String(DEFAULT_PORT)}] [--data-dir <dir>]
  plandesk token create --name <name> [--data-dir <dir>]

Options:
  --data-dir  Workspace directory (default: ~/.plandesk)
  --port      HTTP port for serve (default: ${String(DEFAULT_PORT)})
`;
}
