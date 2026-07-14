import { getFile, getProject, type Db } from '@plandesk/db';
import type { StorageAdapter, StorageResolveResult } from '../storage/adapter.js';

export type FileServiceDeps = {
  db: Db;
  storage: StorageAdapter;
};

export type CreateFileInput = {
  projectId: string;
  filename: string;
  mime: string;
  bytes: Buffer;
};

export type CreatedFile = {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
};

export function createFileService(deps: FileServiceDeps) {
  const { db, storage } = deps;

  return {
    async create(input: CreateFileInput): Promise<CreatedFile | undefined> {
      const project = await getProject(db, input.projectId);
      if (!project) {
        return undefined;
      }

      const { id, url } = await storage.put({
        projectId: input.projectId,
        bytes: input.bytes,
        filename: input.filename,
        mime: input.mime,
      });

      // Content-addressed dedup means the persisted row may reflect an
      // earlier upload of the same bytes — read it back rather than echoing
      // this call's input, so the response always matches what is stored.
      const file = await getFile(db, id);
      if (!file) {
        throw new Error(`Storage adapter did not persist file metadata for ${id}`);
      }

      return { id, url, filename: file.filename, mime: file.mime, size: file.size };
    },

    async get(id: string): Promise<StorageResolveResult | undefined> {
      const resolved = await storage.resolve(id);
      return resolved ?? undefined;
    },
  };
}

export type FileService = ReturnType<typeof createFileService>;
