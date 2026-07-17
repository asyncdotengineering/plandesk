import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createBetterAuth,
  ensureLocalBetterAuthOrganization,
  runBetterAuthMigrations,
} from '@plandesk/api';
import { createDb, migrate, type Db } from '@plandesk/db';
import { resolveDataDir, workspaceDbPath } from './args.js';
import { formatConfigForDoctor, resolveServerConfig, type ResolvedServerConfig } from './config.js';
import {
  formatBindingDoctorReport,
  runBindingDoctor,
  type BindingDoctorReport,
} from './binding-doctor.js';
import { CURATOR_DIR, CURATOR_TEMPLATES } from './curator-templates.js';
import { LAST_EXPORT_FILE } from './export.js';
import { CorruptWorkspaceError, isDbCorruptionError } from './workspace.js';
import { ensureLocalBetterAuthSecret } from './init.js';
import {
  countRows,
  EXPECTED_TABLES,
  hasMigrations,
  listTables,
  missingRequiredTables,
} from './database-schema.js';

export type DoctorReport = {
  healthy: boolean;
  dataDir: string;
  dbPath: string;
  tables: string[];
  missingTables: string[];
  migrationsApplied: boolean;
  projectCount: number;
  taskCount: number;
  issues: string[];
  binding?: BindingDoctorReport;
  curator?: CuratorDoctorReport;
  /** Resolved server config + per-key source (REQ-4). */
  config?: ResolvedServerConfig;
  /** Set when the server targets a remote DB (self-host topology). */
  dbRemote?: string;
  /** ISO timestamp of the last `plandesk export`, or null if never. */
  lastExport: string | null;
};

export type CuratorDoctorReport = {
  present: number;
  total: number;
  missing: string[];
};

// Curator artifact adoption is informational, not a health failure — most
// repos haven't scaffolded the Curator RFC's files and that's not a problem.
function curatorArtifactReport(repoDir: string): CuratorDoctorReport {
  const missing: string[] = [];
  for (const template of CURATOR_TEMPLATES) {
    const path = join(repoDir, CURATOR_DIR, template.relativePath);
    if (!existsSync(path)) {
      missing.push(join(CURATOR_DIR, template.relativePath));
    }
  }
  return {
    present: CURATOR_TEMPLATES.length - missing.length,
    total: CURATOR_TEMPLATES.length,
    missing,
  };
}

function readLastExport(dataDir: string): string | null {
  const path = join(dataDir, LAST_EXPORT_FILE);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8').trim();
    return raw === '' ? null : raw;
  } catch {
    return null;
  }
}

export async function runDoctor(
  dataDirOverride?: string,
  repoDir?: string,
  configPath?: string,
): Promise<DoctorReport> {
  const dataDir = resolveDataDir(dataDirOverride);
  const dbPath = workspaceDbPath(dataDir);
  const issues: string[] = [];

  // Resolve server config up front so the report always shows where each key
  // came from (REQ-4). This never throws on a missing file.
  const config = resolveServerConfig({ configPath, dataDir });

  // Remote DB (self-host topology): the operator owns migrations (REQ-8), so
  // doctor only performs read-only schema inspection.
  if (config.values.dbUrl !== undefined) {
    let binding: BindingDoctorReport | undefined;
    let curator: CuratorDoctorReport | undefined;
    if (repoDir !== undefined) {
      binding = await runBindingDoctor(repoDir);
      if (binding.present) {
        issues.push(...binding.issues);
      }
      curator = curatorArtifactReport(repoDir);
    }
    try {
      const db = await createDb(config.values.dbUrl, config.values.dbToken);
      const tables = await listTables(db);
      const missingTables = missingRequiredTables(tables);
      if (missingTables.length > 0) {
        issues.push(`missing tables: ${missingTables.join(', ')}`);
      }
      const migrationsApplied = await hasMigrations(db, tables);
      if (!migrationsApplied) {
        issues.push('no migrations applied');
      }
      const projectCount = tables.includes('projects') ? await countRows(db, 'projects') : 0;
      const taskCount = tables.includes('tasks') ? await countRows(db, 'tasks') : 0;
      return {
        healthy: issues.length === 0,
        dataDir,
        dbPath: config.values.dbUrl,
        tables,
        missingTables,
        migrationsApplied,
        projectCount,
        taskCount,
        issues,
        binding,
        curator,
        config,
        dbRemote: config.values.dbUrl,
        lastExport: readLastExport(dataDir),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      issues.push(`could not inspect remote schema: ${reason}`);
      return {
        healthy: false,
        dataDir,
        dbPath: config.values.dbUrl,
        tables: [],
        missingTables: [...EXPECTED_TABLES],
        migrationsApplied: false,
        projectCount: 0,
        taskCount: 0,
        issues,
        binding,
        curator,
        config,
        dbRemote: config.values.dbUrl,
        lastExport: readLastExport(dataDir),
      };
    }
  }

  let db: Db;
  try {
    db = await createDb(dbPath);
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: config.values.sessionSecret ?? ensureLocalBetterAuthSecret(dataDir),
      baseURL: config.values.baseUrl ?? 'http://127.0.0.1',
      github: config.values.github,
    });
    if (auth === undefined) throw new Error('Local better-auth secret was not created');
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);
  } catch (err) {
    if (isDbCorruptionError(err)) {
      throw new CorruptWorkspaceError();
    }
    throw err;
  }

  const tables = await listTables(db);
  const missingTables = EXPECTED_TABLES.filter((table) => !tables.includes(table));
  if (missingTables.length > 0) {
    issues.push(`missing tables: ${missingTables.join(', ')}`);
  }

  const migrationsApplied = await hasMigrations(db);
  if (!migrationsApplied) {
    issues.push('no migrations applied');
  }

  const projectCount = tables.includes('projects') ? await countRows(db, 'projects') : 0;
  const taskCount = tables.includes('tasks') ? await countRows(db, 'tasks') : 0;

  let binding: BindingDoctorReport | undefined;
  let curator: CuratorDoctorReport | undefined;
  if (repoDir !== undefined) {
    binding = await runBindingDoctor(repoDir);
    if (binding.present) {
      issues.push(...binding.issues);
    }
    curator = curatorArtifactReport(repoDir);
  }

  return {
    healthy: issues.length === 0,
    dataDir,
    dbPath,
    tables,
    missingTables,
    migrationsApplied,
    projectCount,
    taskCount,
    issues,
    binding,
    curator,
    config,
    lastExport: readLastExport(dataDir),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`Plan Desk doctor — ${report.healthy ? 'OK' : 'FAIL'}`);
  lines.push(`data-dir: ${report.dataDir}`);
  if (report.dbRemote !== undefined) {
    lines.push(`database: ${report.dbRemote} (remote — managed by operator)`);
    lines.push(`migrations: ${report.migrationsApplied ? 'applied' : 'missing'}`);
    lines.push(`tables: ${String(report.tables.length)}`);
    if (report.missingTables.length > 0) {
      lines.push(`missing: ${report.missingTables.join(', ')}`);
    }
    lines.push(`projects: ${String(report.projectCount)}`);
    lines.push(`tasks: ${String(report.taskCount)}`);
  } else {
    lines.push(`database: ${report.dbPath}`);
    lines.push(`migrations: ${report.migrationsApplied ? 'applied' : 'missing'}`);
    lines.push(`tables: ${String(report.tables.length)}`);
    if (report.missingTables.length > 0) {
      lines.push(`missing: ${report.missingTables.join(', ')}`);
    }
    lines.push(`projects: ${String(report.projectCount)}`);
    lines.push(`tasks: ${String(report.taskCount)}`);
  }
  // Global board backup gap: rm -rf ~/.plandesk loses every project with nothing
  // in git. Surface count + last export so the risk is visible.
  lines.push(
    `board: ${String(report.projectCount)} project(s) on this board; last export: ${report.lastExport ?? 'never'}`,
  );
  lines.push(
    'backup: `plandesk export --project <id> --out <path>` (choose a path outside the repo) or hosted via `plandesk push --to <org>`',
  );
  if (report.binding !== undefined) {
    lines.push(...formatBindingDoctorReport(report.binding));
  }
  if (report.curator !== undefined) {
    lines.push(
      `curator: ${String(report.curator.present)}/${String(report.curator.total)} artifacts present`,
    );
    if (report.curator.missing.length > 0) {
      lines.push(`curator-missing: ${report.curator.missing.join(', ')}`);
    }
  }
  if (report.config !== undefined) {
    lines.push('config:');
    lines.push(...formatConfigForDoctor(report.config));
  }
  for (const issue of report.issues) {
    lines.push(`issue: ${issue}`);
  }
  return `${lines.join('\n')}\n`;
}
