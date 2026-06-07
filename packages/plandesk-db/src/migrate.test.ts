import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';

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

function listTables(db: ReturnType<typeof createDb>): string[] {
  const rows = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe('migrate', () => {
  it('creates all RFC §4.4 tables on a fresh database', () => {
    const db = createDb(':memory:');
    migrate(db);
    const tables = listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('is idempotent when run twice', () => {
    const db = createDb(':memory:');
    migrate(db);
    const afterFirst = listTables(db);
    expect(() => {
      migrate(db);
    }).not.toThrow();
    expect(listTables(db)).toEqual(afterFirst);
  });
});
