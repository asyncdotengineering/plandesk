import { createDb, migrate, type Db } from '@plandesk/db';
import { resolveDataDir, workspaceDbPath } from './args.js';
import { CorruptWorkspaceError, isDbCorruptionError } from './workspace.js';

const EXPECTED_TABLES = [
  'projects',
  'tasks',
  'edges',
  'documents',
  'document_comments',
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
};

function listTables(db: Db): string[] {
  const rows = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function countRows(db: Db, table: (typeof EXPECTED_TABLES)[number]): number {
  const row = db.$client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

function hasMigrations(db: Db): boolean {
  const tables = listTables(db);
  if (!tables.includes('__drizzle_migrations')) {
    return false;
  }
  const row = db.$client.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count > 0;
}

export function runDoctor(dataDirOverride?: string): DoctorReport {
  const dataDir = resolveDataDir(dataDirOverride);
  const dbPath = workspaceDbPath(dataDir);
  const issues: string[] = [];

  let db: Db;
  try {
    db = createDb(dbPath);
    migrate(db);
  } catch (err) {
    if (isDbCorruptionError(err)) {
      throw new CorruptWorkspaceError();
    }
    throw err;
  }

  const tables = listTables(db);
  const missingTables = EXPECTED_TABLES.filter((table) => !tables.includes(table));
  if (missingTables.length > 0) {
    issues.push(`missing tables: ${missingTables.join(', ')}`);
  }

  const migrationsApplied = hasMigrations(db);
  if (!migrationsApplied) {
    issues.push('no migrations applied');
  }

  const projectCount = tables.includes('projects') ? countRows(db, 'projects') : 0;
  const taskCount = tables.includes('tasks') ? countRows(db, 'tasks') : 0;

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
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`Plan Desk doctor — ${report.healthy ? 'OK' : 'FAIL'}`);
  lines.push(`data-dir: ${report.dataDir}`);
  lines.push(`database: ${report.dbPath}`);
  lines.push(`migrations: ${report.migrationsApplied ? 'applied' : 'missing'}`);
  lines.push(`tables: ${String(report.tables.length)}`);
  if (report.missingTables.length > 0) {
    lines.push(`missing: ${report.missingTables.join(', ')}`);
  }
  lines.push(`projects: ${String(report.projectCount)}`);
  lines.push(`tasks: ${String(report.taskCount)}`);
  for (const issue of report.issues) {
    lines.push(`issue: ${issue}`);
  }
  return `${lines.join('\n')}\n`;
}
