import {
  listDocuments,
  listNotes,
  listProjects as dbListProjects,
  listTasks,
  type Db,
} from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg } from './scope.js';

export type SearchMatch = {
  id: string;
  project_id: string;
  title: string;
};

export type SearchResult = {
  documents: SearchMatch[];
  tasks: Array<{ id: string; project_id: string; label: string }>;
  notes: SearchMatch[];
};

export type SearchOptions = {
  query: string;
  projectId?: string;
  workspaceId?: string;
  limit?: number;
};

export type SearchServiceDeps = OrgScopedDeps & {
  db: Db;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function matchesNeedle(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function createSearchService(deps: SearchServiceDeps) {
  const { db } = deps;

  async function resolveProjectIds(opts: {
    projectId?: string;
    workspaceId?: string;
  }): Promise<string[]> {
    const orgId = resolveOrgId(deps);
    if (opts.projectId !== undefined) {
      await assertProjectInOrg(db, opts.projectId, orgId);
      return [opts.projectId];
    }

    const ctx = tryGetAuthContext();
    if (ctx?.kind === 'session' && ctx.role === 'member') {
      const rows = await dbListProjects(db, orgId, { workspaceIds: ctx.memberWorkspaceIds });
      return rows.map((project) => project.id);
    }
    if (ctx?.kind === 'apikey' && ctx.projectId !== undefined) {
      await assertProjectInOrg(db, ctx.projectId, orgId);
      return [ctx.projectId];
    }

    const workspaceId =
      opts.workspaceId ??
      ((ctx?.kind === 'apikey' || ctx?.kind === 'loopback') && ctx.workspaceId !== undefined
        ? ctx.workspaceId
        : undefined);

    if (workspaceId === undefined) {
      return [];
    }

    const rows = await dbListProjects(db, orgId, { workspaceId });
    return rows.map((project) => project.id);
  }

  return {
    async search(opts: SearchOptions): Promise<SearchResult> {
      const trimmed = opts.query.trim();
      if (trimmed === '') {
        return { documents: [], tasks: [], notes: [] };
      }

      const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const projectIds = await resolveProjectIds({
        projectId: opts.projectId,
        workspaceId: opts.workspaceId,
      });
      if (projectIds.length === 0) {
        return { documents: [], tasks: [], notes: [] };
      }

      const documents: SearchMatch[] = [];
      const tasks: Array<{ id: string; project_id: string; label: string }> = [];
      const notes: SearchMatch[] = [];

      for (const projectId of projectIds) {
        if (tasks.length < limit) {
          const taskRows = await listTasks(db, projectId);
          for (const task of taskRows) {
            if (matchesNeedle(task.label, trimmed)) {
              tasks.push({ id: task.id, project_id: projectId, label: task.label });
              if (tasks.length >= limit) {
                break;
              }
            }
          }
        }

        if (documents.length < limit) {
          const documentRows = await listDocuments(db, projectId);
          for (const document of documentRows) {
            if (matchesNeedle(document.title, trimmed)) {
              documents.push({
                id: document.id,
                project_id: projectId,
                title: document.title,
              });
              if (documents.length >= limit) {
                break;
              }
            }
          }
        }

        if (notes.length < limit) {
          const noteRows = await listNotes(db, projectId);
          for (const note of noteRows) {
            if (matchesNeedle(note.title, trimmed)) {
              notes.push({ id: note.id, project_id: projectId, title: note.title });
              if (notes.length >= limit) {
                break;
              }
            }
          }
        }

        if (
          tasks.length >= limit &&
          documents.length >= limit &&
          notes.length >= limit
        ) {
          break;
        }
      }

      return { documents, tasks, notes };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
