import type { Db } from './client.js';

export class UnstoredColumnError extends Error {
  constructor(
    public readonly table: string,
    public readonly columns: string[],
  ) {
    super(
      `Table ${table} cannot store column(s): ${columns.join(', ')} — apply pending database migrations`,
    );
    this.name = 'UnstoredColumnError';
  }
}

const columnCache = new WeakMap<Db, Map<string, Set<string>>>();

export async function listTableColumns(db: Db, table: string): Promise<Set<string>> {
  let tables = columnCache.get(db);
  if (tables === undefined) {
    tables = new Map();
    columnCache.set(db, tables);
  }
  const cached = tables.get(table);
  if (cached !== undefined) {
    return cached;
  }
  const result = await db.$client.execute(`PRAGMA table_info(${table})`);
  const columns = new Set<string>();
  for (const row of result.rows) {
    if (typeof row.name === 'string') {
      columns.add(row.name);
    }
  }
  tables.set(table, columns);
  return columns;
}

export async function assertTableStoresColumns(
  db: Db,
  table: string,
  columns: string[],
): Promise<void> {
  const present = await listTableColumns(db, table);
  const missing = columns.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new UnstoredColumnError(table, missing);
  }
}
