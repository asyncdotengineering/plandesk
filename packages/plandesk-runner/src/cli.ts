import { ConfigError } from './config.js';
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
  | { command: 'loop' }
  | { command: 'once' }
  | { command: 'doctor'; configPath?: string };

export function usageText(): string {
  return [
    'usage: plandesk-runner [--config <path>] [--once] [doctor]',
    '',
    '  plandesk-runner            poll the board and execute work (loop)',
    '  plandesk-runner --once     run a single poll pass, then exit',
    '  plandesk-runner doctor     print config, board reachability, and worker rows',
    '',
    '  --config <path>            runner config (default: $PLANDESK_RUNNER_CONFIG,',
    '                            then ~/.plandesk/runner.toml)',
  ].join('\n');
}

/**
 * Parse runner arguments. Bare argv means the loop; `--once` selects a single
 * pass; `doctor` prints the doctor report. `--config <path>` (or
 * `--config=<path>`) overrides the config file location for any command.
 */
export function parseArgs(argv: string[]): ParsedCommand {
  let command: ParsedCommand['command'] | undefined;
  let configPath: string | undefined;
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
    throw new UsageError(`unknown argument: ${arg}`);
  }

  if (command === undefined) {
    command = 'loop';
  }
  return command === 'doctor' ? { command, configPath } : { command };
}

/** CLI entry point. Returns the process exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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

  switch (parsed.command) {
    case 'loop':
      console.log(
        'plandesk-runner: poll loop is not implemented yet — this stub exits 0 (the loop lands in a later task)',
      );
      return 0;
    case 'once':
      console.log(
        'plandesk-runner: single pass (--once) is not implemented yet — this stub exits 0',
      );
      return 0;
    case 'doctor':
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
}
