import type { Client } from '@libsql/client';

export class WalCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalCheckpointError';
  }
}

function checkpointRowValues(row: unknown): {
  busy: number;
  log: number;
  checkpointed: number;
} {
  if (row === undefined || row === null || typeof row !== 'object') {
    throw new WalCheckpointError('PRAGMA wal_checkpoint returned no rows');
  }
  const values = Object.values(row as Record<string, unknown>);
  if (values.length < 3) {
    throw new WalCheckpointError('PRAGMA wal_checkpoint returned an unexpected shape');
  }
  const busy = Number(values[0]);
  const log = Number(values[1]);
  const checkpointed = Number(values[2]);
  if (!Number.isFinite(busy) || !Number.isFinite(log) || !Number.isFinite(checkpointed)) {
    throw new WalCheckpointError('PRAGMA wal_checkpoint returned non-numeric values');
  }
  return { busy, log, checkpointed };
}

/**
 * Fold the WAL into the main database file so a subsequent `copyFileSync` of the
 * `.db` path captures a complete, self-contained database.
 */
export async function checkpointWalForFileCopy(client: Client): Promise<void> {
  const result = await client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  const { busy, log, checkpointed } = checkpointRowValues(result.rows[0]);
  if (busy !== 0) {
    throw new WalCheckpointError(
      `PRAGMA wal_checkpoint(TRUNCATE) was blocked by ${String(busy)} reader(s)`,
    );
  }
  if (log > 0 && checkpointed !== log) {
    throw new WalCheckpointError(
      `PRAGMA wal_checkpoint(TRUNCATE) checkpointed ${String(checkpointed)} of ${String(log)} WAL pages`,
    );
  }
}
