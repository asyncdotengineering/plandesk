import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { runInit } from './init.js';
import { printOnboard } from './onboard.js';
import {
  crashCourse,
  DEFAULT_PORT,
  findLocalPlandeskDir,
  parseArgs,
  resolveBoard,
  resolveDataDir,
  usage,
} from './args.js';
import { resolveEffectivePort } from './connect-artifacts.js';
import { runServe, resolveServeRuntime } from './serve.js';
import { resolveServerConfig, ConfigFileError } from './config.js';
import { runLogin, runLogout, runWhoami } from './login.js';
import { runPreview } from './preview.js';
import {
  AdminInviteOwnerError,
  formatAdminInviteOwnerSummary,
  runAdminInviteOwner,
} from './admin.js';
import { runExport, ProjectNotFoundError } from './export.js';
import { runImport, InvalidImportFileError } from './import.js';
import {
  formatLegacyUpgradePreview,
  formatLegacyUpgradeSummary,
  LegacyUpgradeError,
  previewLegacyUpgrade,
  runLegacyUpgrade,
} from './legacy-upgrade.js';
import { formatGoOnlineSummary, GoOnlineError, runGoOnline } from './go-online.js';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { ConnectError, formatConnectPrint, formatConnectSummary, runConnect } from './connect.js';
import {
  FactoryError,
  formatFactoryInitPrint,
  formatFactoryInitSummary,
  formatFactorySyncSummary,
  runFactoryInit,
  runFactorySync,
} from './factory.js';
import {
  runWorkspaceCreate,
  runWorkspaceList,
  WorkspaceCommandError,
} from './workspace-command.js';
import { formatDisconnectSummary, runDisconnect } from './disconnect.js';
import { runContext } from './context.js';
import { DEFAULT_CHECKPOINT_MESSAGE, runProgressCheckpoint } from './progress-checkpoint.js';
import { formatPushSummary, PromotePushError, runPush } from './push.js';
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
import {
  CORRUPT_DB_HINT,
  CorruptWorkspaceError,
  openWorkspace,
  WorkspaceNotFoundError,
} from './workspace.js';
import {
  backfillDefaultTeams,
  backfillProjectWorkspaces,
  createBetterAuth,
  InvalidShareError,
  runBetterAuthMigrations,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from '@plandesk/api';
import { createDb, migrate } from '@plandesk/db';

function reportCorruptDb(): number {
  process.stderr.write(`${CORRUPT_DB_HINT}\n`);
  return 2;
}

function resolveRepoDir(repoDir?: string): string {
  return repoDir ?? cwd();
}

/**
 * Surface the resolved board before a board-touching command acts (REQ-A1b).
 * Defaults to stdout; `import` prints to stderr instead — its stdout is a
 * single machine-readable project id line that scripts capture directly.
 */
function printBoard(override?: string, localDb?: boolean, stream: 'stdout' | 'stderr' = 'stdout'): void {
  const board = resolveBoard({ override, localDb });
  process[stream].write(`board: ${board.dataDir} (${board.source})\n`);
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
    case 'login':
      try {
        await runLogin(parsed.server ?? 'https://plandesk.asyncdot.com');
        return 0;
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    case 'logout':
      runLogout();
      process.stdout.write('Logged out\n');
      return 0;
    case 'whoami':
      try {
        const config = runWhoami();
        process.stdout.write(`server: ${config.server}\norg: ${config.orgId || '<token login>'}\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    case 'help':
      process.stdout.write(parsed.full ? usage() : crashCourse());
      return 0;
    case 'onboard':
      printOnboard();
      return 0;
    case 'version': {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
      };
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    }
    case 'init': {
      printBoard(parsed.dataDir, parsed.localDb);
      const dbPath = await runInit(parsed.dataDir, { localDb: parsed.localDb });
      process.stdout.write(`Initialized workspace at ${dbPath}\n`);
      return 0;
    }
    case 'serve': {
      try {
        printBoard(parsed.dataDir);
        const runtime = resolveServeRuntime(parsed);
        await runServe({
          port: runtime.port,
          dataDir: runtime.dataDir,
          host: runtime.host,
          strictPort: runtime.strictPort,
          configPath: runtime.configPath,
        });
        return 0;
      } catch (err) {
        if (err instanceof ConfigFileError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'url': {
      const repoDir = resolveRepoDir(parsed.repoDir);
      const plandeskDir = findLocalPlandeskDir(repoDir) ?? join(repoDir, '.plandesk');
      const port = resolveEffectivePort(plandeskDir, DEFAULT_PORT);
      const host = parsed.lan ? (getLanIp() ?? '127.0.0.1') : '127.0.0.1';
      process.stdout.write(`http://${host}:${String(port)}\n`);
      return 0;
    }
    case 'admin': {
      if (parsed.subcommand === 'invite-owner') {
        try {
          if (parsed.dbUrl !== undefined && parsed.dbUrl.trim() !== '') {
            const secret =
              parsed.secret?.trim() ||
              process.env.PLANDESK_BETTER_AUTH_SECRET?.trim() ||
              undefined;
            if (secret === undefined || secret === '') {
              process.stderr.write(
                'Remote invite-owner requires --secret or PLANDESK_BETTER_AUTH_SECRET (must match the deployed Worker secret).\n',
              );
              return 1;
            }
            const db = await createDb(parsed.dbUrl, parsed.dbToken);
            const result = await runAdminInviteOwner(db, {
              email: parsed.email,
              secret,
            });
            process.stdout.write(`${formatAdminInviteOwnerSummary(result)}\n`);
            return 0;
          }

          const { db, dataDir } = await openWorkspace(parsed.dataDir);
          const result = await runAdminInviteOwner(db, {
            email: parsed.email,
            dataDir,
          });
          process.stdout.write(`${formatAdminInviteOwnerSummary(result)}\n`);
          return 0;
        } catch (err) {
          if (err instanceof CorruptWorkspaceError) {
            return reportCorruptDb();
          }
          if (err instanceof AdminInviteOwnerError) {
            process.stderr.write(`${err.message}\n`);
            return 1;
          }
          throw err;
        }
      }
      process.stderr.write(`Unknown admin subcommand\n`);
      return 1;
    }
    case 'export': {
      try {
        printBoard(parsed.dataDir);
        const { db, dataDir } = await openWorkspace(parsed.dataDir);
        await runExport(db, parsed.projectId, parsed.outPath, dataDir);
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
        printBoard(parsed.dataDir, undefined, 'stderr');
        const { db } = await openWorkspace(parsed.dataDir);
        const projectId = await runImport(db, parsed.inPath);
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
    case 'legacy-upgrade': {
      try {
        printBoard(parsed.dataDir);
        if (parsed.print) {
          const preview = await previewLegacyUpgrade({ from: parsed.from, dataDir: parsed.dataDir });
          process.stdout.write(formatLegacyUpgradePreview(preview));
          return 0;
        }
        const result = await runLegacyUpgrade({
          from: parsed.from,
          dataDir: parsed.dataDir,
          intoWorkspace: parsed.intoWorkspace,
        });
        process.stdout.write(`${formatLegacyUpgradeSummary(result)}\n`);
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (err instanceof LegacyUpgradeError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        if (err instanceof WorkspaceNotFoundError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'go-online': {
      try {
        const result = await runGoOnline({
          dataDir: parsed.dataDir,
          to: parsed.to,
          server: parsed.server,
          token: parsed.token,
          all: parsed.all,
          workspaces: parsed.workspaces,
        });
        process.stdout.write(formatGoOnlineSummary(result));
        return 0;
      } catch (err) {
        if (err instanceof GoOnlineError) {
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
          workspace: parsed.workspace,
          url: parsed.url,
          token: parsed.token,
          agent: parsed.agent,
          print: parsed.print,
          to: parsed.to,
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
        printBoard(parsed.dataDir);
        const repoDir = resolveRepoDir(parsed.repoDir);
        const shouldCheckBinding =
          parsed.repoDir !== undefined || existsSync(join(repoDir, '.plandesk', 'config.json'));
        const report = await runDoctor(
          parsed.dataDir,
          shouldCheckBinding ? repoDir : undefined,
          parsed.configPath,
        );
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
    case 'migrate': {
      try {
        const cfg = resolveServerConfig({
          configPath: parsed.configPath,
          dataDir: resolveDataDir(parsed.dataDir),
        });
        const dbUrl = parsed.dbUrl ?? cfg.values.dbUrl;
        if (dbUrl === undefined) {
          process.stderr.write(
            'No database URL configured. Pass --db <url>, set PLANDESK_DB_URL, or set dbUrl in plandesk.server.json.\n',
          );
          return 1;
        }
        const dbToken = parsed.dbToken ?? cfg.values.dbToken;
        const db = await createDb(dbUrl, dbToken);
        await migrate(db);
        const auth = createBetterAuth({
          client: db.$client,
          secret: cfg.values.sessionSecret ?? randomBytes(32).toString('base64url'),
          baseURL: cfg.values.baseUrl ?? 'http://127.0.0.1',
          github: cfg.values.github,
        });
        if (auth === undefined) throw new Error('Better-auth migrator secret was not created');
        await runBetterAuthMigrations(auth);
        // Backfill the workspace tier so existing orgs/projects land in a real
        // team (a default 'General' team per org; every project's workspace_id
        // set to it). Idempotent — mirrors init/serve. Without this an upgraded
        // hosted board has projects pointing at a non-existent workspace.
        const teamsBackfill = await backfillDefaultTeams(auth);
        const projectsBackfill = await backfillProjectWorkspaces(db, auth);
        process.stdout.write(
          `Applied migrations to ${dbUrl}\n` +
            `Backfilled ${String(teamsBackfill.teamsCreated)} default team(s) across ` +
            `${String(teamsBackfill.orgsProcessed)} org(s); set workspace_id on ` +
            `${String(projectsBackfill.projectsUpdated)} project(s).\n`,
        );
        return 0;
      } catch (err) {
        if (err instanceof ConfigFileError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case 'push': {
      try {
        printBoard(parsed.dataDir);
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = await openWorkspace(parsed.dataDir);
        const result = await runPush(db, {
          repoDir,
          projectId: parsed.projectId,
          toOrgId: parsed.toOrgId,
          remoteUrl: parsed.remoteUrl,
        });
        process.stdout.write(formatPushSummary(result));
        return 0;
      } catch (err) {
        if (err instanceof CorruptWorkspaceError) {
          return reportCorruptDb();
        }
        if (
          err instanceof SyncConfigError ||
          err instanceof PromotePushError ||
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
        printBoard(parsed.dataDir);
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = await openWorkspace(parsed.dataDir);
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
    case 'share': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        const { db } = await openWorkspace(parsed.dataDir);
        const result = await runShareCreate(db, {
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
        if (parsed.subcommand === 'sync') {
          const result = runFactorySync({
            repoDir: resolveRepoDir(parsed.repoDir),
            write: parsed.write,
            force: parsed.force,
          });
          process.stdout.write(formatFactorySyncSummary(result));
          return 0;
        }
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
    case 'workspace': {
      try {
        const repoDir = resolveRepoDir(parsed.repoDir);
        if (parsed.subcommand === 'list') {
          await runWorkspaceList({ repoDir, to: parsed.to });
          return 0;
        }
        if (parsed.subcommand === 'create') {
          if (parsed.name === undefined || parsed.name.trim() === '') {
            process.stderr.write('workspace create requires a name\n');
            return 1;
          }
          await runWorkspaceCreate({ repoDir, name: parsed.name.trim(), to: parsed.to });
          return 0;
        }
        process.stderr.write(`Unknown workspace subcommand\n`);
        return 1;
      } catch (err) {
        if (err instanceof WorkspaceCommandError) {
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
