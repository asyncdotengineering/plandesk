import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  DEFAULT_ORG_ID,
  PLANDESK_EXPORT_VERSION,
  createDb,
  getProject,
  importProject,
  listProjects,
  type AgentRunStatus,
  type Client,
  type Db,
  type PlandeskExportV1,
  type PlandeskExportV1AgentRun,
  type PlandeskExportV1Comment,
  type PlandeskExportV1Document,
  type PlandeskExportV1Edge,
  type PlandeskExportV1Note,
  type PlandeskExportV1Task,
  type TaskStatus,
} from '@plandesk/db';
import {
  createBetterAuth,
  createTeamForOrg,
  ensureLocalBetterAuthOrganization,
  runBetterAuthMigrations,
} from '@plandesk/api';
import { PLANDESK_DIR, resolveBoard, WORKSPACE_DB, workspaceDbPath } from './args.js';
import { ensureLocalBetterAuthSecret, runInit } from './init.js';
import {
  CorruptWorkspaceError,
  isDbCorruptionError,
  openWorkspace,
  WorkspaceNotFoundError,
} from './workspace.js';

export class LegacyUpgradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyUpgradeError';
  }
}

export type LegacyUpgradeResult =
  | {
      kind: 'noop';
      reason: 'already_new_schema';
      sourcePath: string;
    }
  | {
      kind: 'imported';
      sourcePath: string;
      backupPath: string;
      orgId: string;
      workspaceId: string;
      workspaceName: string;
      importedProjects: number;
      importedTasks: number;
      importedDocuments: number;
      skipped: number;
    };

type SqlValue = null | number | string | bigint | ArrayBuffer | Uint8Array;
type SqlRow = Record<string, SqlValue>;

const TASK_STATUSES = new Set<string>(['scope', 'todo', 'in_progress', 'done', 'backlog']);
const AGENT_RUN_STATUSES = new Set<string>(['running', 'completed', 'failed']);

function asString(value: SqlValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function asNullableString(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const s = asString(value);
  return s.length === 0 && value !== '' ? null : s;
}

function asNumber(value: SqlValue | undefined, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return fallback;
}

function asBoolean(value: SqlValue | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'bigint') {
    return value !== 0n;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    return lower === '1' || lower === 'true' || lower === 'yes';
  }
  return false;
}

/** Normalize integer-ms or ISO timestamps to ISO strings (exportProject shape). */
export function toIsoTimestamp(value: SqlValue | undefined): string {
  if (value === null || value === undefined) {
    return new Date().toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'bigint') {
    return new Date(Number(value)).toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return new Date().toISOString();
    }
    if (/^-?\d+$/.test(trimmed)) {
      return new Date(Number(trimmed)).toISOString();
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function toNullableIso(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toIsoTimestamp(value);
}

function asTaskStatus(value: SqlValue | undefined): TaskStatus {
  const s = asString(value);
  if (TASK_STATUSES.has(s)) {
    return s as TaskStatus;
  }
  return 'todo';
}

function asAgentRunStatus(value: SqlValue | undefined): AgentRunStatus {
  const s = asString(value);
  if (AGENT_RUN_STATUSES.has(s)) {
    return s as AgentRunStatus;
  }
  return 'completed';
}

async function tableNames(client: Client): Promise<Set<string>> {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  );
  return new Set(result.rows.map((row) => asString((row as SqlRow)['name'])));
}

async function columnNames(client: Client, table: string): Promise<Set<string>> {
  // PRAGMA table_info does not accept bound params for the table name.
  const info = await client.execute(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
  return new Set(info.rows.map((row) => asString((row as SqlRow)['name'])));
}

export async function isAlreadyNewSchema(client: Client): Promise<boolean> {
  const tables = await tableNames(client);
  if (tables.has('organization')) {
    return true;
  }
  if (tables.has('projects')) {
    const cols = await columnNames(client, 'projects');
    if (cols.has('org_id')) {
      return true;
    }
  }
  return false;
}

async function selectAll(client: Client, table: string): Promise<SqlRow[]> {
  const result = await client.execute(`SELECT * FROM "${table.replace(/"/g, '""')}"`);
  return result.rows as SqlRow[];
}

async function selectByProject(
  client: Client,
  table: string,
  projectId: string,
): Promise<SqlRow[]> {
  const result = await client.execute({
    sql: `SELECT * FROM "${table.replace(/"/g, '""')}" WHERE project_id = ?`,
    args: [projectId],
  });
  return result.rows as SqlRow[];
}

function mapTask(row: SqlRow): PlandeskExportV1Task {
  return {
    id: asString(row['id']),
    label: asString(row['label']),
    status: asTaskStatus(row['status']),
    description: asNullableString(row['description']),
    x: asNumber(row['x'], 0),
    y: asNumber(row['y'], 0),
    assignee: asNullableString(row['assignee']),
    due_date: toNullableIso(row['due_date']),
    created_at: toIsoTimestamp(row['created_at']),
    updated_at: toIsoTimestamp(row['updated_at']),
  };
}

function mapEdge(row: SqlRow): PlandeskExportV1Edge {
  return {
    id: asString(row['id']),
    from_task_id: asString(row['from_task_id']),
    to_task_id: asString(row['to_task_id']),
    label: asNullableString(row['label']),
    arrow_direction: asNullableString(row['arrow_direction']),
    style: asNullableString(row['style']),
  };
}

function mapDocument(row: SqlRow): PlandeskExportV1Document {
  return {
    id: asString(row['id']),
    title: asString(row['title']),
    body: asNullableString(row['body']),
    status_line: asNullableString(row['status_line']),
    parent_id: asNullableString(row['parent_id']),
    linked_task_id: asNullableString(row['linked_task_id']),
  };
}

function mapNote(row: SqlRow): PlandeskExportV1Note {
  return {
    id: asString(row['id']),
    title: asString(row['title']),
    body: asNullableString(row['body']),
  };
}

function mapDocumentComment(row: SqlRow): PlandeskExportV1Comment {
  return {
    id: asString(row['id']),
    target_type: 'document',
    target_id: asString(row['document_id']),
    passage: asNullableString(row['passage']),
    body: asString(row['body']),
    resolved: asBoolean(row['resolved']),
    created_at: toIsoTimestamp(row['created_at']),
  };
}

function mapPolymorphicComment(row: SqlRow): PlandeskExportV1Comment {
  const targetTypeRaw = asString(row['target_type']);
  const targetType =
    targetTypeRaw === 'document' ||
    targetTypeRaw === 'task' ||
    targetTypeRaw === 'note' ||
    targetTypeRaw === 'submission' ||
    targetTypeRaw === 'artifact'
      ? targetTypeRaw
      : 'document';
  return {
    id: asString(row['id']),
    target_type: targetType,
    target_id: asString(row['target_id']),
    passage: asNullableString(row['passage']),
    body: asString(row['body']),
    resolved: asBoolean(row['resolved']),
    created_at: toIsoTimestamp(row['created_at']),
  };
}

async function mapAgentRuns(
  client: Client,
  tables: Set<string>,
  projectId: string,
): Promise<PlandeskExportV1AgentRun[]> {
  if (!tables.has('agent_runs')) {
    return [];
  }
  const runs = await selectByProject(client, 'agent_runs', projectId);
  const eventsByRun = new Map<string, Array<{ message: string; created_at: string }>>();
  if (tables.has('agent_run_events')) {
    for (const run of runs) {
      const runId = asString(run['id']);
      const events = await client.execute({
        sql: 'SELECT message, created_at FROM agent_run_events WHERE run_id = ? ORDER BY created_at ASC',
        args: [runId],
      });
      eventsByRun.set(
        runId,
        (events.rows as SqlRow[]).map((event) => ({
          message: asString(event['message']),
          created_at: toIsoTimestamp(event['created_at']),
        })),
      );
    }
  }
  return runs.map((run) => {
    const id = asString(run['id']);
    return {
      id,
      status: asAgentRunStatus(run['status']),
      label: asNullableString(run['label']),
      started_at: toIsoTimestamp(run['started_at']),
      completed_at: toNullableIso(run['completed_at']),
      events: eventsByRun.get(id) ?? [],
    };
  });
}

export async function readLegacyProjectExports(
  client: Client,
): Promise<Array<{ sourceProjectId: string; export: PlandeskExportV1 }>> {
  const tables = await tableNames(client);
  if (!tables.has('projects')) {
    throw new LegacyUpgradeError('Legacy board has no projects table');
  }

  const projects = await selectAll(client, 'projects');
  const out: Array<{ sourceProjectId: string; export: PlandeskExportV1 }> = [];

  for (const project of projects) {
    const sourceProjectId = asString(project['id']);
    if (sourceProjectId === '') {
      continue;
    }

    const taskRows = tables.has('tasks')
      ? await selectByProject(client, 'tasks', sourceProjectId)
      : [];
    const edgeRows = tables.has('edges')
      ? await selectByProject(client, 'edges', sourceProjectId)
      : [];
    const documentRows = tables.has('documents')
      ? await selectByProject(client, 'documents', sourceProjectId)
      : [];
    const noteRows = tables.has('notes')
      ? await selectByProject(client, 'notes', sourceProjectId)
      : [];

    let comments: PlandeskExportV1Comment[] = [];
    if (tables.has('comments')) {
      const commentRows = await selectByProject(client, 'comments', sourceProjectId);
      comments = commentRows.map(mapPolymorphicComment);
    } else if (tables.has('document_comments')) {
      const documentIds = new Set(documentRows.map((row) => asString(row['id'])));
      const allDocComments = await selectAll(client, 'document_comments');
      comments = allDocComments
        .filter((row) => documentIds.has(asString(row['document_id'])))
        .map(mapDocumentComment);
    }

    const agentRuns = await mapAgentRuns(client, tables, sourceProjectId);

    out.push({
      sourceProjectId,
      export: {
        version: PLANDESK_EXPORT_VERSION,
        project: {
          name: asString(project['name']) || 'Untitled',
          description: asNullableString(project['description']),
          canvas_layout: asNullableString(project['canvas_layout']),
        },
        goals: [],
        tasks: taskRows.map(mapTask),
        tags: [],
        edges: edgeRows.map(mapEdge),
        folders: [],
        documents: documentRows.map(mapDocument),
        notes: noteRows.map(mapNote),
        comments,
        agent_runs: agentRuns,
        files: [],
        artifacts: [],
      },
    });
  }

  return out;
}

/**
 * Default source resolution for an old board:
 * --from if given, else ~/.plandesk/workspace.db, else ./.plandesk/workspace.db.
 */
export function resolveLegacySourcePath(from?: string, cwd: string = process.cwd()): string | undefined {
  if (from !== undefined && from.trim() !== '') {
    return from;
  }
  const globalPath = join(homedir(), PLANDESK_DIR, WORKSPACE_DB);
  if (existsSync(globalPath)) {
    return globalPath;
  }
  const localPath = join(cwd, PLANDESK_DIR, WORKSPACE_DB);
  if (existsSync(localPath)) {
    return localPath;
  }
  return undefined;
}

export function legacyBackupPath(sourcePath: string): string {
  return `${sourcePath}.pre-legacy-upgrade`;
}

/**
 * True when a DB file already holds app tables but was never migrated through
 * drizzle (no `__drizzle_migrations` tracking rows). Migrating such a DB
 * replays the baseline `CREATE TABLE` statements (no `IF NOT EXISTS`) over
 * tables that already exist and crashes with a raw sqlite error.
 */
export async function isUnmigratedLegacyDb(client: Client): Promise<boolean> {
  const tables = await tableNames(client);
  if (tables.has('__drizzle_migrations')) {
    return false;
  }
  return tables.has('projects') || tables.has('agent_run_events');
}

export function legacyUpgradeTargetConflictMessage(dbPath: string): string {
  return `a board already exists at ${dbPath}; run \`plandesk init\` first, or pass --data-dir <empty dir>`;
}

/**
 * Guard the target board before anything touches it: an existing, unmigrated
 * legacy DB at the target path must never reach `migrate()` (REQ-A2a).
 */
async function assertTargetSafeToMigrate(targetDbPath: string): Promise<void> {
  if (!existsSync(targetDbPath)) {
    return;
  }
  const targetDb = await createDb(targetDbPath);
  try {
    if (await isUnmigratedLegacyDb(targetDb.$client)) {
      throw new LegacyUpgradeError(legacyUpgradeTargetConflictMessage(targetDbPath));
    }
  } catch (err) {
    if (err instanceof LegacyUpgradeError) {
      throw err;
    }
    if (isDbCorruptionError(err)) {
      throw new CorruptWorkspaceError();
    }
    throw err;
  } finally {
    targetDb.$client.close();
  }
}

function projectAlreadyPresent(
  existing: Awaited<ReturnType<typeof listProjects>>,
  sourceProjectId: string,
  name: string,
): boolean {
  if (existing.some((p) => p.id === sourceProjectId)) {
    return true;
  }
  // importProject remaps project ids; re-run safety uses stable name under the default org.
  return existing.some((p) => p.name === name);
}

export function formatLegacyUpgradeSummary(result: LegacyUpgradeResult): string {
  if (result.kind === 'noop') {
    return 'already upgraded / new schema, nothing to do';
  }
  return (
    `Imported ${String(result.importedProjects)} projects, ${String(result.importedTasks)} tasks, ` +
    `${String(result.importedDocuments)} documents into workspace "${result.workspaceName}" (org ${result.orgId}). ` +
    `Skipped: ${String(result.skipped)} already present. ` +
    `Old board backed up to ${result.backupPath}. ` +
    `Regenerate a CLI token via the dashboard for hosted use.`
  );
}

export type LegacyUpgradePreview = {
  sourcePath: string;
  targetDbPath: string;
  alreadyNewSchema: boolean;
  wouldImport: number;
  wouldSkip: number;
  /** Set when the target board is an unmigrated legacy DB that would refuse the real run. */
  targetConflict?: string;
};

/**
 * Dry-run: resolve source + target and report what would import/skip. Never
 * writes anything — no backup, no target board creation, no import (REQ-A2b).
 */
export async function previewLegacyUpgrade(options: {
  from?: string;
  dataDir?: string;
  cwd?: string;
}): Promise<LegacyUpgradePreview> {
  const sourcePath = resolveLegacySourcePath(options.from, options.cwd ?? process.cwd());
  if (sourcePath === undefined) {
    throw new LegacyUpgradeError(
      'No legacy workspace.db found. Pass --from <path> or place the old board at ~/.plandesk/workspace.db or ./.plandesk/workspace.db.',
    );
  }
  if (!existsSync(sourcePath)) {
    throw new LegacyUpgradeError(`Legacy board not found: ${sourcePath}`);
  }

  const targetDataDir = resolveBoard({ override: options.dataDir }).dataDir;
  const targetDbPath = workspaceDbPath(targetDataDir);

  let targetConflict: string | undefined;
  try {
    await assertTargetSafeToMigrate(targetDbPath);
  } catch (err) {
    if (err instanceof LegacyUpgradeError) {
      targetConflict = err.message;
    } else {
      throw err;
    }
  }

  const sourceDb = await createDb(sourcePath);
  try {
    if (await isAlreadyNewSchema(sourceDb.$client)) {
      return { sourcePath, targetDbPath, alreadyNewSchema: true, wouldImport: 0, wouldSkip: 0, targetConflict };
    }

    const exports = await readLegacyProjectExports(sourceDb.$client);
    let wouldSkip = 0;
    if (targetConflict === undefined && existsSync(targetDbPath)) {
      try {
        const { db } = await openWorkspace(targetDataDir);
        const existing = await listProjects(db, DEFAULT_ORG_ID);
        wouldSkip = exports.filter((item) =>
          projectAlreadyPresent(existing, item.sourceProjectId, item.export.project.name),
        ).length;
      } catch {
        // Target unreadable for preview purposes — report as if nothing is present yet.
      }
    }

    return {
      sourcePath,
      targetDbPath,
      alreadyNewSchema: false,
      wouldImport: exports.length - wouldSkip,
      wouldSkip,
      targetConflict,
    };
  } finally {
    sourceDb.$client.close();
  }
}

export function formatLegacyUpgradePreview(preview: LegacyUpgradePreview): string {
  const lines = [
    `[dry-run] source: ${preview.sourcePath}`,
    `[dry-run] target: ${preview.targetDbPath}`,
  ];
  if (preview.targetConflict !== undefined) {
    lines.push(`[dry-run] conflict: ${preview.targetConflict}`);
  } else if (preview.alreadyNewSchema) {
    lines.push('[dry-run] source is already upgraded / new schema — nothing to import');
  } else {
    lines.push(`[dry-run] would import: ${String(preview.wouldImport)} project(s)`);
    lines.push(`[dry-run] would skip (already present): ${String(preview.wouldSkip)} project(s)`);
  }
  lines.push('[dry-run] nothing written');
  return `${lines.join('\n')}\n`;
}

export async function runLegacyUpgrade(options: {
  from?: string;
  dataDir?: string;
  cwd?: string;
  intoWorkspace?: string | true;
}): Promise<LegacyUpgradeResult> {
  const sourcePath = resolveLegacySourcePath(options.from, options.cwd ?? process.cwd());
  if (sourcePath === undefined) {
    throw new LegacyUpgradeError(
      'No legacy workspace.db found. Pass --from <path> or place the old board at ~/.plandesk/workspace.db or ./.plandesk/workspace.db.',
    );
  }
  if (!existsSync(sourcePath)) {
    throw new LegacyUpgradeError(`Legacy board not found: ${sourcePath}`);
  }

  const targetDataDir = resolveBoard({ override: options.dataDir }).dataDir;
  await assertTargetSafeToMigrate(workspaceDbPath(targetDataDir));

  const sourceDb = await createDb(sourcePath);
  try {
    if (await isAlreadyNewSchema(sourceDb.$client)) {
      return { kind: 'noop', reason: 'already_new_schema', sourcePath };
    }

    const exports = await readLegacyProjectExports(sourceDb.$client);
    const backupPath = legacyBackupPath(sourcePath);
    if (!existsSync(backupPath)) {
      copyFileSync(sourcePath, backupPath);
    }

    // Single-command upgrade: create the global board if it does not exist yet,
    // then import into it. `init` is otherwise a separate step the user must run.
    let db: Db;
    let dataDir: string;
    try {
      ({ db, dataDir } = await openWorkspace(options.dataDir));
    } catch (err) {
      if (err instanceof WorkspaceNotFoundError) {
        await runInit(options.dataDir);
        ({ db, dataDir } = await openWorkspace(options.dataDir));
      } else {
        throw err;
      }
    }

    const auth = createBetterAuth({
      client: db.$client,
      secret: ensureLocalBetterAuthSecret(dataDir),
      baseURL: 'http://127.0.0.1',
    });
    if (auth === undefined) throw new Error('Local better-auth secret was not created');
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);

    const workspaceName =
      typeof options.intoWorkspace === 'string' && options.intoWorkspace.trim() !== ''
        ? options.intoWorkspace.trim()
        : basename(dirname(sourcePath));

    const adapter = (await auth.$context).adapter;
    const existingTeams = await adapter.findMany<{ id: string; name: string; organizationId: string }>({
      model: 'team',
      where: [{ field: 'organizationId', value: DEFAULT_ORG_ID }],
    });
    const existingTeam = existingTeams.find((t) => t.name === workspaceName);
    const team = existingTeam ?? (await createTeamForOrg(auth, DEFAULT_ORG_ID, workspaceName));

    return await importLegacyExports(db, exports, {
      sourcePath,
      backupPath,
      orgId: DEFAULT_ORG_ID,
      workspaceId: team.id,
      workspaceName,
    });
  } finally {
    sourceDb.$client.close();
  }
}

async function importLegacyExports(
  db: Db,
  exports: Array<{ sourceProjectId: string; export: PlandeskExportV1 }>,
  meta: { sourcePath: string; backupPath: string; orgId: string; workspaceId: string; workspaceName: string },
): Promise<LegacyUpgradeResult> {
  let importedProjects = 0;
  let importedTasks = 0;
  let importedDocuments = 0;
  let skipped = 0;

  let existing = await listProjects(db, meta.orgId, { workspaceId: meta.workspaceId });

  for (const item of exports) {
    if (projectAlreadyPresent(existing, item.sourceProjectId, item.export.project.name)) {
      skipped += 1;
      continue;
    }

    // Re-check getProject for source id (covers any future preserve-id path).
    if ((await getProject(db, item.sourceProjectId)) !== undefined) {
      skipped += 1;
      continue;
    }

    await importProject(db, item.export, { orgId: meta.orgId, workspaceId: meta.workspaceId });
    importedProjects += 1;
    importedTasks += item.export.tasks.length;
    importedDocuments += item.export.documents.length;
    existing = await listProjects(db, meta.orgId, { workspaceId: meta.workspaceId });
  }

  return {
    kind: 'imported',
    sourcePath: meta.sourcePath,
    backupPath: meta.backupPath,
    orgId: meta.orgId,
    workspaceId: meta.workspaceId,
    workspaceName: meta.workspaceName,
    importedProjects,
    importedTasks,
    importedDocuments,
    skipped,
  };
}
