import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { createFile, getFileInOrg, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import type { S3Config } from '../read-server-env.js';
import { fileUrl, StorageError, type StorageAdapter } from './adapter.js';

const SAFE_KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export type S3AdapterDeps = {
  db: Db;
  config: S3Config;
};

/**
 * Content-addressed S3-compatible storage (AWS, MinIO, R2's S3 API) over
 * SigV4-signed fetch, so it runs on Node, Workers and Vercel alike. Same
 * layout and org scoping as the R2 adapter: bytes at `{projectId}/{sha256}`,
 * the `files` row holds metadata only, and `resolve` goes through
 * `getFileInOrg`. GETs are proxied, so the bucket never needs to be public.
 */
export function createS3Adapter(deps: S3AdapterDeps): StorageAdapter {
  const { db, config } = deps;
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
    // aws4fetch defaults to 10 backoff retries; a degraded bucket would hold the
    // request past Workers/Vercel time limits. Fail fast and let the caller retry.
    retries: 1,
  });
  // Path-style, so custom endpoints need no per-bucket DNS.
  const origin = (config.endpoint ?? `https://s3.${config.region}.amazonaws.com`).replace(
    /\/+$/,
    '',
  );
  // Imported rows carry ids verbatim, and URL normalisation would let `..` or a
  // `/` walk out of `{bucket}/{projectId}/` into another tenant's keys (or the
  // bucket listing). Only plain id-shaped segments ever reach a signed request.
  const objectUrl = (projectId: string, id: string): string | undefined =>
    SAFE_KEY_SEGMENT.test(projectId) && SAFE_KEY_SEGMENT.test(id)
      ? `${origin}/${config.bucket}/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`
      : undefined;

  return {
    async put(input) {
      const id = createHash('sha256').update(new Uint8Array(input.bytes)).digest('hex');
      const url = objectUrl(input.projectId, id);
      if (url === undefined) {
        throw new StorageError(`Refusing S3 key for project "${input.projectId}"`, 400);
      }
      const res = await client.fetch(url, {
        method: 'PUT',
        headers: { 'content-type': input.mime },
        body: new Uint8Array(input.bytes),
      });
      await res.body?.cancel();
      if (!res.ok) {
        throw new StorageError(
          `S3 PUT to bucket "${config.bucket}" failed: ${String(res.status)}`,
          res.status,
        );
      }
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
      const url = objectUrl(file.projectId, id);
      if (url === undefined) {
        return null;
      }
      const res = await client.fetch(url);
      if (!res.ok) {
        await res.body?.cancel();
        if (res.status === 404) {
          return null;
        }
        throw new StorageError(
          `S3 GET from bucket "${config.bucket}" failed: ${String(res.status)}`,
          res.status,
        );
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return { bytes, mime: file.mime, filename: file.filename };
    },
  };
}
