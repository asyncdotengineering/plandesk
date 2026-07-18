import { getFile, getFileInOrg, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
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
      assertPermission(deps, 'document', 'create');
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
      const auth = tryGetAuthContext();
      if (auth === undefined || auth.kind === 'guest') {
        return undefined;
      }
      const file = await getFileInOrg(db, id, auth.orgId);
      if (!file) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, file.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      const resolved = await storage.resolve(id);
      return resolved ?? undefined;
    },
  };
}

export type FileService = ReturnType<typeof createFileService>;
