import { createHash } from 'node:crypto';
import { createFile, getFileInOrg, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import { fileUrl, type StorageAdapter } from './adapter.js';

/**
 * Minimal R2Bucket surface used by the adapter (matches Workers binding API).
 * Tests supply an in-memory fake; production passes env.FILES.
 */
export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
  head(key: string): Promise<{
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
};

export type R2AdapterDeps = {
  db: Db;
  bucket: R2BucketLike;
};

// Per-project object key, mirroring the (project_id, id) primary key of the
// `files` table: identical bytes in different projects never collide.
function objectKey(projectId: string, id: string): string {
  return `${projectId}/${id}`;
}

/**
 * Content-addressed R2 storage via the native Workers binding (not S3 creds).
 * Bytes live in the bucket under `{projectId}/{sha256}`; the `files` row records
 * metadata + org linkage. `resolve` is org-scoped through `getFileInOrg` — the
 * bare content id is never a lookup key, so one tenant cannot read another's
 * bytes by knowing the hash (mirrors the local/s3 adapters).
 */
export function createR2Adapter(deps: R2AdapterDeps): StorageAdapter {
  const { db, bucket } = deps;

  return {
    async put(input) {
      const id = createHash('sha256').update(input.bytes).digest('hex');
      const body = new Uint8Array(input.bytes);
      await bucket.put(objectKey(input.projectId, id), body, {
        httpMetadata: { contentType: input.mime },
        customMetadata: {
          filename: input.filename,
          mime: input.mime,
          projectId: input.projectId,
        },
      });
      // Persist the metadata row so FileService.create can read it back and so
      // resolve() can org-scope. Bytes stay in R2 (bytes: null in the DB).
      await createFile(db, {
        id,
        projectId: input.projectId,
        filename: input.filename,
        mime: input.mime,
        size: input.bytes.length,
        bytes: null,
        externalUrl: null,
      });
      return { id, url: fileUrl(id) };
    },

    async resolve(id) {
      const auth = tryGetAuthContext();
      if (auth === undefined || auth.kind === 'guest') {
        return null;
      }
      const file = await getFileInOrg(db, id, auth.orgId);
      if (!file) {
        return null;
      }
      if (file.externalUrl) {
        return { redirectUrl: file.externalUrl };
      }
      const obj = await bucket.get(objectKey(file.projectId, id));
      if (obj === null) {
        return null;
      }
      const bytes = Buffer.from(await obj.arrayBuffer());
      return { bytes, mime: file.mime, filename: file.filename };
    },
  };
}
