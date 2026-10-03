import type { Db } from './client.js';
import { MIGRATIONS } from './migrations.generated.js';

export type SchemaMigrationSummary = {
  applied: number;
  shipped: number;
  current: boolean;
  latestAppliedTag: string | null;
  latestShippedTag: string;
  missingTags: string[];
};

export class SchemaDriftError extends Error {
  constructor(public readonly summary: SchemaMigrationSummary) {
    super(formatSchemaDriftMessage(summary));
    this.name = 'SchemaDriftError';
  }
}

export function listShippedMigrationTags(): string[] {
  return MIGRATIONS.map((entry) => entry.tag);
}

function cellToNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function listAppliedMigrationCreatedAts(db: Db): Promise<number[]> {
  const tables = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
  );
  if (tables.rows.length === 0) {
    return [];
  }
  const result = await db.$client.execute(
    'SELECT created_at FROM __drizzle_migrations ORDER BY created_at',
  );
  return result.rows
    .map((row) => cellToNumber(row.created_at))
    .filter((value): value is number => value !== null);
}

export async function getSchemaMigrationSummary(db: Db): Promise<SchemaMigrationSummary> {
  const shippedTags = listShippedMigrationTags();
  const appliedCreatedAts = await listAppliedMigrationCreatedAts(db);
  const appliedSet = new Set(appliedCreatedAts);
  const missingTags = MIGRATIONS.filter((entry) => !appliedSet.has(entry.when)).map(
    (entry) => entry.tag,
  );
  const appliedTags = MIGRATIONS.filter((entry) => appliedSet.has(entry.when)).map(
    (entry) => entry.tag,
  );
  return {
    applied: appliedCreatedAts.length,
    shipped: shippedTags.length,
    current: missingTags.length === 0 && appliedCreatedAts.length === shippedTags.length,
    latestAppliedTag: appliedTags.at(-1) ?? null,
    latestShippedTag: shippedTags[shippedTags.length - 1] ?? '',
    missingTags,
  };
}

export function formatSchemaDriftMessage(summary: SchemaMigrationSummary): string {
  const missing =
    summary.missingTags.length > 0 ? ` Missing: ${summary.missingTags.join(', ')}.` : '';
  return (
    `Database schema is behind the server (${String(summary.applied)}/${String(summary.shipped)} migrations applied).` +
    missing +
    ' Run pending migrations before serving.'
  );
}

export async function assertSchemaCurrent(db: Db): Promise<void> {
  const summary = await getSchemaMigrationSummary(db);
  if (!summary.current) {
    throw new SchemaDriftError(summary);
  }
}
