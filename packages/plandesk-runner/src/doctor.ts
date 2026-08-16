import { join } from 'node:path';
import { loadConfig, readEnv, redact, CONFIG_PATH_ENV, type RunnerConfig } from './config.js';
import {
  describeExclusion,
  findFactoryWorkersDir,
  listWorkerFiles,
  NoUsableWorkersError,
  resolveWorkersIn,
  type Exclusion,
  type Worker,
  type WorkerFile,
} from './workers.js';

export interface DoctorBoardResult {
  url: string;
  /** True when the board answered with any HTTP status (auth/404 still proves reachability). */
  reachable: boolean;
  status?: number;
  error?: string;
}

/** The declare-then-probe worker outcome, flattened for the doctor report. */
export interface DoctorWorkerResolution {
  /** Worker ids the repository declared (one per `*.md` file, sorted). */
  declared: string[];
  /** Effective enabled set: `config.workers` when non-empty, else all declared. */
  enabled: string[];
  /** Names enabled in config but not declared by the repo (config mistakes). */
  enabledButNotDeclared: string[];
  usable: Worker[];
  excluded: Exclusion[];
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
  /** Worker resolution against the loaded config; undefined when no workers dir was found. */
  resolution: DoctorWorkerResolution | undefined;
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
 * Resolve workers for the doctor report without ever throwing for an empty
 * usable set: a NoUsableWorkersError still yields a full resolution (usable
 * empty, exclusions recorded) so doctor can print it instead of failing.
 */
async function resolveWorkerResolution(
  workersDir: string,
  config: RunnerConfig,
  files: WorkerFile[],
): Promise<DoctorWorkerResolution> {
  const declared = files.map((file) => file.id);
  const enabled = config.workers.length > 0 ? [...config.workers] : declared;
  const enabledButNotDeclared = config.workers.filter((name) => !declared.includes(name));
  try {
    const resolved = await resolveWorkersIn(workersDir, config);
    return { declared, enabled, enabledButNotDeclared, usable: resolved.usable, excluded: resolved.excluded };
  } catch (error) {
    if (error instanceof NoUsableWorkersError) {
      return { declared, enabled, enabledButNotDeclared, usable: [], excluded: error.excluded };
    }
    throw error;
  }
}

/**
 * Collect everything `plandesk-runner doctor` prints: the redacted config, a
 * board reachability ping (unauthenticated — any HTTP response counts as
 * reachable), and one row per worker declaration file with its
 * repo-declared / config-enabled / probe-ready status plus the resulting
 * usable set. Never throws for an unreachable board, a missing workers dir,
 * or an empty usable set; those become report fields. Config problems still
 * throw ConfigError from loadConfig.
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
  const resolution =
    workersDir === undefined ? undefined : await resolveWorkerResolution(workersDir, config, workers);

  return {
    configPath,
    configPathSource,
    config: redact(config),
    board,
    workersDir,
    workersSearchedFrom: cwd,
    workers,
    resolution,
  };
}

function formatWorkerRow(name: string, resolution: DoctorWorkerResolution): string {
  const worker = resolution.usable.find((entry) => entry.name === name);
  const exclusion = resolution.excluded.find((entry) => entry.worker === name);
  const declared = resolution.declared.includes(name) ? 'yes' : 'no';
  const enabled = resolution.enabled.includes(name) ? 'yes' : 'no';
  const probeReady =
    worker !== undefined ? 'yes' : exclusion?.reason === 'probe-failed' ? 'no' : 'n/a';
  let suffix: string;
  if (worker !== undefined) {
    suffix = worker.resolvedVersion === undefined ? '' : ` version=${worker.resolvedVersion}`;
  } else if (exclusion !== undefined) {
    suffix = ` — excluded: ${describeExclusion(exclusion)}`;
  } else {
    suffix = ' — not declared by this repository';
  }
  return `  ${name.padEnd(16)} repo-declared=${declared} config-enabled=${enabled} probe-ready=${probeReady}${suffix}`;
}

function workerRows(report: DoctorReport): string[] {
  if (report.workersDir === undefined) {
    return [
      `no .agents/factory/workers directory found (searched up from ${report.workersSearchedFrom})`,
    ];
  }
  const lines = [
    `workers (${String(report.workers.length)}) from ${report.workersDir}:`,
  ];
  const resolution = report.resolution;
  if (resolution === undefined) {
    return lines;
  }
  if (resolution.declared.length === 0) {
    lines.push(`${report.workersDir} contains no *.md worker files`);
    return lines;
  }
  for (const name of resolution.declared) {
    lines.push(formatWorkerRow(name, resolution));
  }
  for (const name of resolution.enabledButNotDeclared) {
    lines.push(formatWorkerRow(name, resolution));
  }
  const usableNames = resolution.usable.map((worker) => worker.name).join(', ');
  lines.push(`usable (${String(resolution.usable.length)}): ${usableNames.length > 0 ? usableNames : '(none)'}`);
  return lines;
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
    ...workerRows(report),
  ];
  return lines.join('\n');
}
