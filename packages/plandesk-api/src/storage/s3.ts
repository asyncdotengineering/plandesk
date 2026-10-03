import { createHash } from 'node:crypto';
import { getFileInOrg, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import type { S3Config } from '../read-server-env.js';
import { type StorageAdapter } from './adapter.js';

export type S3AdapterDeps = {
  db: Db;
  config: S3Config;
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
