import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { runInit } from './init.js';
import { parseArgs, usage } from './args.js';
import { runServe } from './serve.js';
import { runTokenCreate } from './token.js';
import { runExport, ProjectNotFoundError } from './export.js';
import { runImport, InvalidImportFileError } from './import.js';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { ConnectError, formatConnectPrint, formatConnectSummary, runConnect } from './connect.js';
import { formatDisconnectSummary, runDisconnect } from './disconnect.js';
import { CORRUPT_DB_HINT, CorruptWorkspaceError, openWorkspace } from './workspace.js';

function reportCorruptDb(): number {
  process.stderr.write(`${CORRUPT_DB_HINT}\n`);
  return 2;
}

function resolveRepoDir(repoDir?: string): string {
  return repoDir ?? cwd();
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const parsed = parseArgs(argv);

  switch (parsed.command) {
    case 'help':
      process.stdout.write(usage());
      return 0;
    case 'init': {
      const dbPath = runInit(parsed.dataDir);
      process.stdout.write(`Initialized workspace at ${dbPath}\n`);
      return 0;
    }
    case 'serve':
      runServe({ port: parsed.port, dataDir: parsed.dataDir, host: parsed.host });
      return 0;
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
    case 'unknown':
      process.stderr.write(`Unknown command: ${parsed.name}\n\n${usage()}`);
      return 1;
  }
}
