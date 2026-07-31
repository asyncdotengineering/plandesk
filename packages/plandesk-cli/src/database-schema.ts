import type { Db } from '@plandesk/db';

export const EXPECTED_TABLES = [
  'projects',
  'tasks',
  'edges',
  'documents',
  'comments',
  'revisions',
  'agent_runs',
  'agent_run_events',
  '__drizzle_migrations',
] as const;

export const BETTER_AUTH_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  'apikey',
] as const;

export const REQUIRED_TABLES = [...EXPECTED_TABLES, ...BETTER_AUTH_TABLES] as const;

export function readStringCell(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${column} to be a string`);
  }
  return value;
}

export async function listTables(db: Db): Promise<string[]> {
  const result = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return result.rows.map((row) => readStringCell(row.name, 'sqlite_master.name'));
}

export function missingRequiredTables(tables: readonly string[]): string[] {
  return REQUIRED_TABLES.filter((table) => !tables.includes(table));
}

export async function hasMigrations(db: Db, tables?: readonly string[]): Promise<boolean> {
  const knownTables = tables ?? (await listTables(db));
  if (!knownTables.includes('__drizzle_migrations')) {
    return false;
  }
  const result = await db.$client.execute('SELECT COUNT(*) AS count FROM __drizzle_migrations');
  const row = result.rows[0];
  return Number(row?.count ?? 0) > 0;
}

export async function countRows(db: Db, table: string): Promise<number> {
  const result = await db.$client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  const row = result.rows[0];
  return Number(row?.count ?? 0);
}
