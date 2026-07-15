import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, migrate, type Db } from '@plandesk/db';
import { resolveDataDir, workspaceDbPath } from './args.js';
import { formatConfigForDoctor, resolveServerConfig, type ResolvedServerConfig } from './config.js';
import {
  formatBindingDoctorReport,
  runBindingDoctor,
  type BindingDoctorReport,
} from './binding-doctor.js';
import { CURATOR_DIR, CURATOR_TEMPLATES } from './curator-templates.js';
import { CorruptWorkspaceError, isDbCorruptionError } from './workspace.js';

const EXPECTED_TABLES = [
  'projects',
  'tasks',
  'edges',
  'documents',
  'comments',
  'agent_runs',
  'agent_run_events',
  'mcp_tokens',
  '__drizzle_migrations',
] as const;

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

async function listTables(db: Db): Promise<string[]> {
  const result = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

async function countRows(db: Db, table: (typeof EXPECTED_TABLES)[number]): Promise<number> {
  const result = await db.$client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  const row = result.rows[0];
  return Number(row?.count ?? 0);
}

async function hasMigrations(db: Db): Promise<boolean> {
  const tables = await listTables(db);
  if (!tables.includes('__drizzle_migrations')) {
    return false;
  }
  const result = await db.$client.execute('SELECT COUNT(*) AS count FROM __drizzle_migrations');
  const row = result.rows[0];
  return Number(row?.count ?? 0) > 0;
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
  // doctor does not open or migrate it. Report the config and skip the local
  // file inspection that only applies to the local topology.
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
    return {
      healthy: issues.length === 0,
      dataDir,
      dbPath: config.values.dbUrl,
      tables: [],
      missingTables: [],
      migrationsApplied: true,
      projectCount: 0,
      taskCount: 0,
      issues,
      binding,
      curator,
      config,
      dbRemote: config.values.dbUrl,
    };
  }

  let db: Db;
  try {
    db = await createDb(dbPath);
    await migrate(db);
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
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`Plan Desk doctor — ${report.healthy ? 'OK' : 'FAIL'}`);
  lines.push(`data-dir: ${report.dataDir}`);
  if (report.dbRemote !== undefined) {
    lines.push(`database: ${report.dbRemote} (remote — managed by operator)`);
    lines.push(`schema: run 'plandesk migrate --db ${report.dbRemote}'`);
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
