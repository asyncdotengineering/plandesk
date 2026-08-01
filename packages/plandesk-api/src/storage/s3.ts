import { createHash } from 'node:crypto';
import { getFileInOrg, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import { type StorageAdapter } from './adapter.js';

export type S3AdapterConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
};

export function readS3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3AdapterConfig {
  const bucket = env.PLANDESK_S3_BUCKET;
  const region = env.PLANDESK_S3_REGION;
  const accessKeyId = env.PLANDESK_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.PLANDESK_S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'PLANDESK_STORAGE=s3 requires PLANDESK_S3_BUCKET, PLANDESK_S3_REGION, ' +
        'PLANDESK_S3_ACCESS_KEY_ID, and PLANDESK_S3_SECRET_ACCESS_KEY to be set.',
    );
  }
  return { bucket, region, accessKeyId, secretAccessKey, endpoint: env.PLANDESK_S3_ENDPOINT };
}

export type S3AdapterDeps = {
  db: Db;
  config: S3AdapterConfig;
};

// No AWS SDK dependency is present in this workspace (see plandesk-api/package.json).
// `put` is a stub: it satisfies the StorageAdapter contract and documents the
// intended key layout, but does not perform a real upload. Implementing it
// means either a dependency-free SigV4-signed REST PUT to `config.bucket`/key,
// or adding an S3 SDK dependency — the LOCAL adapter is the fully working path.
export function createS3Adapter(deps: S3AdapterDeps): StorageAdapter {
  const { db, config } = deps;

  return {
    put(input) {
      const id = createHash('sha256').update(new Uint8Array(input.bytes)).digest('hex');
      const key = `${input.projectId}/${id}`;
      return Promise.reject(
        new Error(`s3 adapter not built: cannot PUT "${key}" to bucket "${config.bucket}"`),
      );
    },

    async resolve(id) {
      const auth = tryGetAuthContext();
      if (auth === undefined || auth.kind === 'guest') {
        return null;
      }
      const file = await getFileInOrg(db, id, auth.orgId);
      if (!file?.externalUrl) {
        return null;
      }
      return { redirectUrl: file.externalUrl };
    },
  };
}
