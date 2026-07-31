/** True when SQLite could not acquire a lock (concurrent writer). */
export function isSqliteBusy(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const record = error as { code?: string; rawCode?: number; cause?: unknown };
  if (
    record.code === 'SQLITE_BUSY' ||
    record.code === 'SQLITE_BUSY_SNAPSHOT' ||
    record.rawCode === 5 ||
    record.rawCode === 517
  ) {
    return true;
  }
  if (record.cause !== undefined) {
    return isSqliteBusy(record.cause);
  }
  return false;
}

const BUSY_RETRY_ATTEMPTS = 5;
const BUSY_RETRY_DELAY_MS = 2;

/** Retry a write that may SQLITE_BUSY while a peer transaction holds the lock. */
export async function retryOnSqliteBusy<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < BUSY_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isSqliteBusy(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < BUSY_RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}
