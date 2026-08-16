import { ConfigError, loadConfig } from './config.js';
import type { RunnerConfig } from './config.js';
import { createBoardClient, BoardError } from './board.js';
import { runLoop, runOnce } from './loop.js';
import { formatDoctorReport, runDoctor } from './doctor.js';

/** Thrown by parseArgs for arguments it does not understand. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export type ParsedCommand =
  | { command: 'help' }
  | { command: 'loop'; configPath?: string; projectId?: string }
  | { command: 'once'; configPath?: string; projectId?: string }
  | { command: 'doctor'; configPath?: string };

/** Environment variable consulted for the project binding. */
export const PROJECT_ID_ENV = 'PLANDESK_PROJECT_ID';

export function usageText(): string {
  return [
    'usage: plandesk-runner [--config <path>] [--project <id>] [--once] [doctor]',
    '',
    '  plandesk-runner            poll the board and execute work (loop)',
    '  plandesk-runner --once     run a single poll pass, then exit',
    '  plandesk-runner doctor     print config, board reachability, and worker rows',
    '',
    '  --config <path>            runner config (default: $PLANDESK_RUNNER_CONFIG,',
    '                            then ~/.plandesk/runner.toml)',
    '  --project <id>             the board project to work (default:',
    '                            $PLANDESK_PROJECT_ID) — required for the loop',
    '                            and --once; the board REST surface is',
    '                            project-scoped',
  ].join('\n');
}

/**
 * Parse runner arguments. Bare argv means the loop; `--once` selects a single
 * pass; `doctor` prints the doctor report. `--config <path>` (or
 * `--config=<path>`) overrides the config file location for any command;
 * `--project <id>` (or `--project=<id>`) binds the loop/once pass to one
 * board project.
 */
export function parseArgs(argv: string[]): ParsedCommand {
  let command: ParsedCommand['command'] | undefined;
  let configPath: string | undefined;
  let projectId: string | undefined;
  const rest = [...argv];

  for (;;) {
    const arg = rest.shift();
    if (arg === undefined) {
      break;
    }
    if (arg === 'help' || arg === '--help' || arg === '-h') {
      return { command: 'help' };
    }
    if (arg === '--once') {
      command = 'once';
      continue;
    }
    if (arg === 'doctor') {
      command = 'doctor';
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      const value = rest.shift();
      if (value === undefined || value.length === 0) {
        throw new UsageError('--config requires a file path');
      }
      configPath = value;
      continue;
    }
    if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      continue;
    }
    if (arg === '--project' || arg === '-p') {
      const value = rest.shift();
      if (value === undefined || value.length === 0) {
        throw new UsageError('--project requires a project id');
      }
      projectId = value;
      continue;
    }
    if (arg.startsWith('--project=')) {
      projectId = arg.slice('--project='.length);
      continue;
    }
    throw new UsageError(`unknown argument: ${arg}`);
  }

  if (command === undefined) {
    command = 'loop';
  }
  if (command === 'doctor') {
    return { command, configPath };
  }
  return { command, configPath, projectId };
}

/** Injection points for tests; production calls use globals and signals. */
export interface MainOptions {
  /** Board HTTP fetch implementation. Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the loop/once pass from outside. Default: SIGINT/SIGTERM. */
  signal?: AbortSignal;
}

/**
 * Resolve the project binding: the `--project` argument, then the
 * PLANDESK_PROJECT_ID environment variable. The loop and the single pass
 * both need one — the board's REST surface is project-scoped, so there is no
 * board-wide "next task" to fall back to.
 */
function resolveProjectId(parsed: { projectId?: string }): string {
  if (parsed.projectId !== undefined && parsed.projectId.length > 0) {
    return parsed.projectId;
  }
  return process.env[PROJECT_ID_ENV]?.trim() ?? '';
}

/** Load config for a work command; missing binding → UsageError. */
function loadWorkContext(
  configPath: string | undefined,
  projectIdArg: string | undefined,
): { config: RunnerConfig; projectId: string } {
  const projectId = resolveProjectId({ projectId: projectIdArg });
  if (projectId.length === 0) {
    throw new UsageError(
      `a project binding is required — pass --project <id> or set ${PROJECT_ID_ENV}`,
    );
  }
  return { config: loadConfig(configPath), projectId };
}

/**
 * CLI entry point. Returns the process exit code. Bare invocation runs the
 * poll loop; `--once` claims at most one task, settles it, and exits 0
 * whatever the outcome (the board carries it); `doctor` reports and exits 0.
 */
export async function main(argv: string[] = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}\n\n${usageText()}`);
      return 2;
    }
    throw error;
  }

  if (parsed.command === 'help') {
    console.log(usageText());
    return 0;
  }

  if (parsed.command === 'doctor') {
    try {
      const report = await runDoctor({ configPath: parsed.configPath });
      console.log(formatDoctorReport(report));
      return 0;
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`error: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  let config: RunnerConfig;
  let projectId: string;
  try {
    const context = loadWorkContext(parsed.configPath, parsed.projectId);
    config = context.config;
    projectId = context.projectId;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}\n\n${usageText()}`);
      return 2;
    }
    if (error instanceof ConfigError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const board = createBoardClient(config, projectId, { fetchImpl: options.fetchImpl });
  const controller = new AbortController();
  const onSignal = (): void => {
    controller.abort();
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onSignal, { once: true });
    }
  } else {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  try {
    if (parsed.command === 'loop') {
      await runLoop(config, board, controller.signal);
      return 0;
    }
    const result = await runOnce(config, board, controller.signal);
    console.log(`plandesk-runner --once: ${result}`);
    return 0;
  } catch (error) {
    if (error instanceof BoardError) {
      console.error(`error: board ${error.method} ${error.path} failed: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    if (options.signal !== undefined) {
      options.signal.removeEventListener('abort', onSignal);
    } else {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}
