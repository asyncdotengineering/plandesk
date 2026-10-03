import {
  checkDocumentReferences,
  getProject,
  listDocuments,
  type Db,
  type ReferenceCheckFs,
  type ReferenceCheckResult,
} from '@plandesk/db';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';

export type ReferenceCheckServiceDeps = OrgScopedDeps & {
  db: Db;
  /** Omit on Workers — checks always return `unknown: true`. */
  referenceCheckFs?: ReferenceCheckFs | null;
};

export function createReferenceCheckService(deps: ReferenceCheckServiceDeps) {
  const { db } = deps;
  const fs = deps.referenceCheckFs ?? null;

  return {
    async check(projectId: string): Promise<ReferenceCheckResult | undefined> {
      assertPermission(deps, 'document', 'read');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      const project = await getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      const documents = await listDocuments(db, projectId);
      const withSource = documents
        .filter((doc) => doc.sourcePath !== null && doc.sourcePath.trim() !== '')
        .map((doc) => ({
          id: doc.id,
          title: doc.title,
          sourcePath: doc.sourcePath as string,
        }));

      return checkDocumentReferences(project.folderPath, withSource, fs);
    },
  };
}

export type ReferenceCheckService = ReturnType<typeof createReferenceCheckService>;
