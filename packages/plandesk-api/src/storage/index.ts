import type { Db } from '@plandesk/db';
import type { StorageAdapter } from './adapter.js';
import { createLocalBlobAdapter } from './local.js';
import { createR2Adapter, type R2BucketLike } from './r2.js';
import { createS3Adapter, readS3ConfigFromEnv } from './s3.js';

export * from './adapter.js';
export { createLocalBlobAdapter } from './local.js';
export { createR2Adapter, type R2BucketLike } from './r2.js';
export { createS3Adapter, readS3ConfigFromEnv, type S3AdapterConfig } from './s3.js';

export type CreateStorageAdapterDeps = {
  db: Db;
  env?: NodeJS.ProcessEnv;
  /** When set (Workers), prefer the native R2 binding over S3/local. */
  r2?: R2BucketLike;
};

export function createStorageAdapter(deps: CreateStorageAdapterDeps): StorageAdapter {
  if (deps.r2 !== undefined) {
    return createR2Adapter({ db: deps.db, bucket: deps.r2 });
  }
  const env = deps.env ?? process.env;
  const kind = env.PLANDESK_STORAGE ?? 'local';

  if (kind === 's3') {
    return createS3Adapter({ db: deps.db, config: readS3ConfigFromEnv(env) });
  }
  if (kind !== 'local') {
    throw new Error(`Unknown PLANDESK_STORAGE adapter: "${kind}". Expected "local" or "s3".`);
  }
  return createLocalBlobAdapter({ db: deps.db });
}
