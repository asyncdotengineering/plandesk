import { getFile, type Db } from '@plandesk/db';
import type { StorageAdapter, StorageResolveResult } from '../storage/adapter.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type FileServiceDeps = OrgScopedDeps & {
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
      assertPermission(deps, 'editor');
      try {
        await assertProjectInOrg(db, input.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
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
      const file = await getFile(db, input.projectId, id);
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
