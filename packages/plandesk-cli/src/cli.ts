import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { runInit } from './init.js';
import { crashCourse, DEFAULT_PORT, findLocalPlandeskDir, parseArgs, resolveDataDir, usage } from './args.js';
import { readWorkspaceJson, resolveEffectivePort } from './connect-artifacts.js';
import { runServe } from './serve.js';
import { runPreview } from './preview.js';
import { runTokenCreate } from './token.js';
import { runExport, ProjectNotFoundError } from './export.js';
import { runImport, InvalidImportFileError } from './import.js';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { ConnectError, formatConnectPrint, formatConnectSummary, runConnect } from './connect.js';
import {
  FactoryError,
  formatFactoryInitPrint,
  formatFactoryInitSummary,
  runFactoryInit,
} from './factory.js';
import { formatDisconnectSummary, runDisconnect } from './disconnect.js';
import { runContext } from './context.js';
import { DEFAULT_CHECKPOINT_MESSAGE, runProgressCheckpoint } from './progress-checkpoint.js';
import { formatPublishSummary, runPublish } from './publish.js';
import { formatPushSummary, runPush } from './push.js';
import { formatPullSummary, runPull } from './pull.js';
import { formatShareCreateSummary, InvalidShareArgsError, runShareCreate } from './share.js';
import {
  DeploySpecUnavailableError,
  fetchDeploySpec,
  formatDeployIndex,
  formatPipeTip,
  formatUnknownTarget,
  isKnownTarget,
} from './deploy.js';
import { SyncConfigError } from './sync.js';
import { LocalServerUnreachableError, runWatch, SseDisconnectedError } from './watch.js';
import {
  CORRUPT_DB_HINT,
  CorruptWorkspaceError,
  openWorkspace,
  WorkspaceNotFoundError,
} from './workspace.js';
import { InvalidShareError, SyncUnauthorizedError, SyncUnavailableError } from '@plandesk/api';

function reportCorruptDb(): number {
  process.stderr.write(`${CORRUPT_DB_HINT}\n`);
  return 2;
}

function resolveRepoDir(repoDir?: string): string {
  return repoDir ?? cwd();
}

function getLanIp(): string | undefined {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return undefined;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const parsed = parseArgs(argv);
  try {
    return await dispatch(parsed);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function dispatch(parsed: ReturnType<typeof parseArgs>): Promise<number> {
  switch (parsed.command) {
    case 'help':
      process.stdout.write(parsed.full ? usage() : crashCourse());
      return 0;
    case 'version': {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
      };
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    }
    case 'init': {
      const dbPath = await runInit(parsed.dataDir);
      process.stdout.write(`Initialized workspace at ${dbPath}\n`);
      return 0;
    }
    case 'serve': {
      const dataDir = resolveDataDir(parsed.dataDir);
      const workspacePort = readWorkspaceJson(dataDir)?.port;
      const port = parsed.port ?? workspacePort ?? DEFAULT_PORT;
      runServe({ port, dataDir: parsed.dataDir, host: parsed.host, strictPort: parsed.strictPort });
      return 0;
    }
    case 'url': {
      const repoDir = resolveRepoDir(parsed.repoDir);
      const plandeskDir = findLocalPlandeskDir(repoDir) ?? join(repoDir, '.plandesk');
      const port = resolveEffectivePort(plandeskDir, DEFAULT_PORT);
      const host = parsed.lan ? (getLanIp() ?? '127.0.0.1') : '127.0.0.1';
      process.stdout.write(`http://${host}:${String(port)}\n`);
      return 0;
    }
    case 'token': {
      try {
        const { db } = openWorkspace(parsed.dataDir);
        const token = runTokenCreate(db, parsed.name);
        process.stdout.write(`${token}\n`);
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        throw err;
      }
    }
    case 'export': {
      try {
        const { db } = openWorkspace(parsed.dataDir);
        runExport(db, parsed.projectId, parsed.outPath);
        process.stdout.write(`Exported project ${parsed.projectId} to ${parsed.outPath}\n`);
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (err instanceof ProjectNotFoundError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'import': {
      try {
        const { db } = openWorkspace(parsed.dataDir);
        const projectId = runImport(db, parsed.inPath);
        process.stdout.write(`${projectId}\n`);
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (err instanceof InvalidImportFileError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'connect': {
      try {
        const result = await runConnect({
          repoDir: resolveRepoDir(parsed.repoDir),
          project: parsed.project,
          url: parsed.url,
          token: parsed.token,
          agent: parsed.agent,
          print: parsed.print,
        });
        process.stdout.write(
          parsed.print ? formatConnectPrint(result) : formatConnectSummary(result),
        );
        return 0;
      } catch (err) {
        if (err instanceof ConnectError) {
          process.stderr.write(`${err.message}\n`);
          return err.exitCode;
        }
        throw err;
      }
    }
    case 'disconnect': {
      const result = runDisconnect({ repoDir: resolveRepoDir(parsed.repoDir) });
      process.stdout.write(formatDisconnectSummary(result));
      return 0;
    }
    case 'doctor': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const shouldCheckBinding =
          parsed.repoDir !== undefined || existsSync(join(repoDir, '.plandesk', 'config.json'));
        const report = await runDoctor(parsed.dataDir, shouldCheckBinding ? repoDir : undefined);
        process.stdout.write(formatDoctorReport(report));
        return report.healthy ? 0 : 1;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          process.stderr.write(`${err.message}\n`);
          return 2;
        }
        throw err;
      }
    }
    case 'publish': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = openWorkspace(parsed.dataDir);
        const result = await runPublish(db, {
          repoDir,
          projectId: parsed.projectId,
          remoteUrl: parsed.remoteUrl,
          syncToken: parsed.syncToken,
        });
        process.stdout.write(formatPublishSummary(result));
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (
          err instanceof SyncConfigError ||
          err instanceof SyncUnauthorizedError ||
          err instanceof SyncUnavailableError
        ) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'push': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = openWorkspace(parsed.dataDir);
        const result = await runPush(db, { repoDir, projectId: parsed.projectId });
        process.stdout.write(formatPushSummary(result));
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (
          err instanceof SyncConfigError ||
          err instanceof SyncUnauthorizedError ||
          err instanceof SyncUnavailableError
        ) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'pull': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = openWorkspace(parsed.dataDir);
        const result = await runPull(db, { repoDir, projectId: parsed.projectId });
        process.stdout.write(formatPullSummary(result));
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (
          err instanceof SyncConfigError ||
          err instanceof SyncUnauthorizedError ||
          err instanceof SyncUnavailableError
        ) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'sync': {
      if (!parsed.watch) {
        process.stderr.write('sync requires --watch\n');
        return 1;
      }
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = openWorkspace(parsed.dataDir);
        await runWatch(db, { repoDir, projectId: parsed.projectId });
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (
          err instanceof SyncConfigError ||
          err instanceof SyncUnauthorizedError ||
          err instanceof SyncUnavailableError ||
          err instanceof LocalServerUnreachableError ||
          err instanceof SseDisconnectedError
        ) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'share': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = openWorkspace(parsed.dataDir);
        const result = runShareCreate(db, {
          repoDir,
          projectId: parsed.projectId,
          audienceName: parsed.audience,
          public: parsed.public,
          invite: parsed.invite,
          expires: parsed.expires,
          allowSubmit: parsed.allowSubmit,
        });
        process.stdout.write(formatShareCreateSummary(result));
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (
          err instanceof SyncConfigError ||
          err instanceof InvalidShareArgsError ||
          err instanceof InvalidShareError
        ) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'deploy': {
      if (parsed.target === undefined) {
        process.stdout.write(formatDeployIndex());
        return 0;
      }
      if (!isKnownTarget(parsed.target)) {
        process.stderr.write(formatUnknownTarget(parsed.target));
        return 1;
      }
      try {
        const spec = await fetchDeploySpec(parsed.target);
        process.stdout.write(spec.endsWith('\n') ? spec : `${spec}\n`);
        if (process.stdout.isTTY) {
          process.stderr.write(formatPipeTip(parsed.target));
        }
        return 0;
      } catch (err) {
        if (err instanceof DeploySpecUnavailableError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'factory': {
      try {
        const result = runFactoryInit({
          repoDir: resolveRepoDir(parsed.repoDir),
          print: parsed.print,
          force: parsed.force,
        });
        process.stdout.write(
          parsed.print ? formatFactoryInitPrint(result) : formatFactoryInitSummary(result),
        );
        return 0;
      } catch (err) {
        if (err instanceof FactoryError) {
          process.stderr.write(`${err.message}\n`);
          return err.exitCode;
        }
        throw err;
      }
    }
    case 'context': {
      const repoDir = resolveRepoDir(parsed.repoDir);
      const context = await runContext(repoDir);
      process.stdout.write(`${JSON.stringify(context)}\n`);
      return 0;
    }
    case 'progress-checkpoint': {
      const repoDir = resolveRepoDir(parsed.repoDir);
      await runProgressCheckpoint(repoDir, parsed.message ?? DEFAULT_CHECKPOINT_MESSAGE);
      return 0;
    }
    case 'preview': {
      return runPreview({
        paths: parsed.paths,
        port: parsed.port,
        host: parsed.host,
        open: parsed.open,
      });
    }
    case 'unknown':
      process.stderr.write(`Unknown command: ${parsed.name}\n\n${usage()}`);
      return 1;
  }
}
