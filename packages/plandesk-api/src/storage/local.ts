import { createHash } from 'node:crypto';
import { createFile, getFile, type Db } from '@plandesk/db';
import { fileUrl, type StorageAdapter } from './adapter.js';

export type LocalBlobAdapterDeps = {
  db: Db;
};

export function createLocalBlobAdapter(deps: LocalBlobAdapterDeps): StorageAdapter {
  const { db } = deps;

  return {
    put(input) {
      const id = createHash('sha256').update(input.bytes).digest('hex');
      createFile(db, {
        id,
        projectId: input.projectId,
        filename: input.filename,
        mime: input.mime,
        size: input.bytes.length,
        bytes: input.bytes,
      });
      return Promise.resolve({ id, url: fileUrl(id) });
    },

    resolve(id) {
      const file = getFile(db, id);
      if (!file) {
        return Promise.resolve(null);
      }
      if (file.externalUrl) {
        return Promise.resolve({ redirectUrl: file.externalUrl });
      }
      if (!file.bytes) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ bytes: file.bytes, mime: file.mime, filename: file.filename });
    },
  };
}
