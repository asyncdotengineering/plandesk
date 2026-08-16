import { join } from 'node:path';
import { loadConfig, readEnv, redact, CONFIG_PATH_ENV, type RunnerConfig } from './config.js';
import { findFactoryWorkersDir, listWorkerFiles, type WorkerFile } from './workers.js';

export interface DoctorBoardResult {
  url: string;
  /** True when the board answered with any HTTP status (auth/404 still proves reachability). */
  reachable: boolean;
  status?: number;
  error?: string;
}

export interface DoctorReport {
  /** Config file path that was loaded (as passed, or the env/default location). */
  configPath: string;
  configPathSource: 'argument' | 'environment' | 'default';
  /** The loaded config, already redacted — safe to print. */
  config: RunnerConfig;
  board: DoctorBoardResult;
  /** Directory worker rows were listed from; undefined when none was found. */
  workersDir: string | undefined;
  /** Directory the workers dir search started from (for the "not found" note). */
  workersSearchedFrom: string;
  workers: WorkerFile[];
}

export interface DoctorOptions {
  /** Config file path; defaults to PLANDESK_RUNNER_CONFIG then ~/.plandesk/runner.toml. */
  configPath?: string;
  /** Working directory the workers dir search starts from. Default: process.cwd(). */
  cwd?: string;
  /** Skip discovery and list this directory directly. */
  workersDir?: string;
  /** Board ping timeout in ms. Default: 5000. */
  timeoutMs?: number;
  /** Injectable fetch for tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_DOCTOR_TIMEOUT_MS = 5000;

async function pingBoard(
  boardUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<DoctorBoardResult> {
  try {
    const response = await fetchImpl(boardUrl, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { url: boardUrl, reachable: true, status: response.status };
  } catch (cause) {
    return { url: boardUrl, reachable: false, error: (cause as Error).message };
  }
}

/**
 * Collect everything `plandesk-runner doctor` prints: the redacted config, a
 * board reachability ping (unauthenticated — any HTTP response counts as
 * reachable), and one row per worker declaration file. Never throws for an
 * unreachable board or a missing workers dir; those become report fields.
 * Config problems still throw ConfigError from loadConfig.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const configPath = options.configPath ?? readEnv(CONFIG_PATH_ENV) ?? '~/.plandesk/runner.toml';
  const configPathSource: DoctorReport['configPathSource'] =
    options.configPath !== undefined
      ? 'argument'
      : readEnv(CONFIG_PATH_ENV) !== undefined
        ? 'environment'
        : 'default';

  const config = loadConfig(options.configPath);
  const cwd = options.cwd ?? process.cwd();
  const workersDir = options.workersDir ?? findFactoryWorkersDir(cwd);

  const board = await pingBoard(
    config.boardUrl,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? DEFAULT_DOCTOR_TIMEOUT_MS,
  );
  const workers = listWorkerFiles(workersDir ?? join(cwd, '.agents', 'factory', 'workers'));

  return {
    configPath,
    configPathSource,
    config: redact(config),
    board,
    workersDir,
    workersSearchedFrom: cwd,
    workers,
  };
}

function workerRows(report: DoctorReport): string[] {
  if (report.workersDir === undefined) {
    return [
      `no .agents/factory/workers directory found (searched up from ${report.workersSearchedFrom})`,
    ];
  }
  if (report.workers.length === 0) {
    return [`${report.workersDir} contains no *.md worker files`];
  }
  return report.workers.map((worker) => `  ${worker.id.padEnd(16)} ${worker.path}`);
}

/** Render the doctor report as the text `plandesk-runner doctor` prints. */
export function formatDoctorReport(report: DoctorReport): string {
  const boardLine = report.board.reachable
    ? `board ${report.board.url}: reachable (HTTP ${String(report.board.status)})`
    : `board ${report.board.url}: unreachable — ${String(report.board.error)}`;

  const lines = [
    'plandesk-runner doctor',
    '',
    `config (${report.configPathSource}): ${report.configPath}`,
    'config (agent_key redacted):',
    JSON.stringify(report.config, null, 2),
    '',
    boardLine,
    '',
    `workers (${String(report.workers.length)}):`,
    ...workerRows(report),
  ];
  return lines.join('\n');
}
