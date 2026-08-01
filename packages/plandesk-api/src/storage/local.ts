import { createHash } from 'node:crypto';
import { createFile, getFileInOrg, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import { fileUrl, type StorageAdapter } from './adapter.js';

export type LocalBlobAdapterDeps = {
  db: Db;
};

export function createLocalBlobAdapter(deps: LocalBlobAdapterDeps): StorageAdapter {
  const { db } = deps;

  return {
    async put(input) {
      const id = createHash('sha256').update(new Uint8Array(input.bytes)).digest('hex');
      await createFile(db, {
        id,
        projectId: input.projectId,
        filename: input.filename,
        mime: input.mime,
        size: input.bytes.length,
        bytes: input.bytes,
      });
      return { id, url: fileUrl(id) };
    },

    async resolve(id) {
      const auth = tryGetAuthContext();
      const file =
        auth !== undefined && auth.kind !== 'guest'
          ? await getFileInOrg(db, id, auth.orgId)
          : // Fallback for non-request paths: content hash is not globally unique;
            // without org context we cannot safely resolve.
            undefined;
      if (!file) {
        return null;
      }
      if (file.externalUrl) {
        return { redirectUrl: file.externalUrl };
      }
      if (!file.bytes) {
        return null;
      }
      return { bytes: file.bytes, mime: file.mime, filename: file.filename };
    },
  };
}
