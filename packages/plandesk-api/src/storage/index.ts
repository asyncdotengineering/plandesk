import type { Db } from '@plandesk/db';
import type { StorageConfig } from '../read-server-env.js';
import type { StorageAdapter } from './adapter.js';
import { createLocalBlobAdapter } from './local.js';
import { createR2Adapter, type R2BucketLike } from './r2.js';
import { createS3Adapter } from './s3.js';

export * from './adapter.js';
export { createLocalBlobAdapter } from './local.js';
export { createR2Adapter, type R2BucketLike } from './r2.js';
export { createS3Adapter } from './s3.js';

export type CreateStorageAdapterDeps = {
  db: Db;
  /** From `readServerEnv` (or the Node config file). Unset → bytes in the database. */
  storage?: StorageConfig;
  /** When set (Workers), the native R2 binding wins over `storage`. */
  r2?: R2BucketLike;
};

export function createStorageAdapter(deps: CreateStorageAdapterDeps): StorageAdapter {
  if (deps.r2 !== undefined) {
    return createR2Adapter({ db: deps.db, bucket: deps.r2 });
  }
  if (deps.storage?.kind === 's3') {
    return createS3Adapter({ db: deps.db, config: deps.storage });
  }
  return createLocalBlobAdapter({ db: deps.db });
}
