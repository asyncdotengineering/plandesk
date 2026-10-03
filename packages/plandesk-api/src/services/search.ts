import { listProjects, type Db } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
import { resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg } from './scope.js';
import { buildSearchExcerpt, fts5MatchExpression, plainBodyForSearch } from './search-text.js';

export type SearchMatchedField = 'title' | 'body';

export type SearchDocumentMatch = {
  id: string;
  project_id: string;
  title: string;
  matched: SearchMatchedField;
  excerpt: string | null;
};

export type SearchTaskMatch = {
  id: string;
  project_id: string;
  label: string;
  matched: SearchMatchedField;
  excerpt: string | null;
};

export type SearchNoteMatch = {
  id: string;
  project_id: string;
  title: string;
  matched: SearchMatchedField;
  excerpt: string | null;
};

export type SearchResult = {
  documents: SearchDocumentMatch[];
  tasks: SearchTaskMatch[];
  notes: SearchNoteMatch[];
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

type IndexRow = {
  kind: string;
  item_id: string;
  project_id: string;
  title: string;
  body: string;
  rank: number;
};

function cellString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || value === undefined) {
    return '';
  }
  throw new Error(`expected a scalar column value, got ${typeof value}`);
}

function cellNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapIndexRow(row: Record<string, unknown>): IndexRow {
  return {
    kind: cellString(row.kind),
    item_id: cellString(row.item_id),
    project_id: cellString(row.project_id),
    title: cellString(row.title),
    body: cellString(row.body),
    rank: cellNumber(row.rank),
  };
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
      const rows = await listProjects(db, orgId, { workspaceIds: ctx.memberWorkspaceIds });
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

    const rows = await listProjects(db, orgId, { workspaceId });
    return rows.map((project) => project.id);
  }

  async function queryIndexRows(
    projectIds: string[],
    sqlBody: string,
    args: Array<string | number>,
    needle: string,
    candidateLimit: number,
  ): Promise<IndexRow[]> {
    if (projectIds.length === 0) {
      return [];
    }
    const placeholders = projectIds.map(() => '?').join(', ');
    // Order before the LIMIT: candidates are truncated, so ranking only after
    // fetching would drop the best hits (title matches first, then bm25).
    const sql = `${sqlBody} AND project_id IN (${placeholders})
      ORDER BY instr(lower(title), lower(?)) = 0, rank
      LIMIT ?`;
    const boundArgs: Array<string | number> = [...args, ...projectIds, needle, candidateLimit];
    const result = await db.$client.execute(sql, boundArgs);
    return result.rows.map((row) => mapIndexRow(row as Record<string, unknown>));
  }

  function acceptRow(
    row: IndexRow,
    needle: string,
    titleOnly: boolean,
  ): {
    matched: SearchMatchedField;
    excerpt: string | null;
  } | null {
    const lowerNeedle = needle.toLowerCase();
    const titleMatch = row.title.toLowerCase().includes(lowerNeedle);
    if (titleOnly) {
      return titleMatch ? { matched: 'title', excerpt: null } : null;
    }
    const plainBody = plainBodyForSearch(row.kind, row.body);
    const bodyMatch = plainBody.toLowerCase().includes(lowerNeedle);
    if (!titleMatch && !bodyMatch) {
      return null;
    }
    if (titleMatch) {
      return { matched: 'title', excerpt: null };
    }
    return {
      matched: 'body',
      excerpt: buildSearchExcerpt(plainBody, needle),
    };
  }

  function pushMatches(
    rows: IndexRow[],
    needle: string,
    titleOnly: boolean,
    limit: number,
    result: SearchResult,
  ): void {
    const sorted = [...rows].sort((a, b) => {
      const aAccept = acceptRow(a, needle, titleOnly);
      const bAccept = acceptRow(b, needle, titleOnly);
      const aTitle = aAccept?.matched === 'title' ? 0 : 1;
      const bTitle = bAccept?.matched === 'title' ? 0 : 1;
      if (aTitle !== bTitle) {
        return aTitle - bTitle;
      }
      return a.rank - b.rank;
    });

    for (const row of sorted) {
      const accepted = acceptRow(row, needle, titleOnly);
      if (accepted === null) {
        continue;
      }
      if (row.kind === 'document' && result.documents.length < limit) {
        result.documents.push({
          id: row.item_id,
          project_id: row.project_id,
          title: row.title,
          matched: accepted.matched,
          excerpt: accepted.excerpt,
        });
      } else if (row.kind === 'task' && result.tasks.length < limit) {
        result.tasks.push({
          id: row.item_id,
          project_id: row.project_id,
          label: row.title,
          matched: accepted.matched,
          excerpt: accepted.excerpt,
        });
      } else if (row.kind === 'note' && result.notes.length < limit) {
        result.notes.push({
          id: row.item_id,
          project_id: row.project_id,
          title: row.title,
          matched: accepted.matched,
          excerpt: accepted.excerpt,
        });
      }
      if (
        result.documents.length >= limit &&
        result.tasks.length >= limit &&
        result.notes.length >= limit
      ) {
        break;
      }
    }
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

      const result: SearchResult = { documents: [], tasks: [], notes: [] };
      const candidateLimit = limit * 5;
      const titleOnly = trimmed.length < 3;

      let rows: IndexRow[];
      // ponytail: SQLite lower() folds ASCII only, so a 1–2 character
      // non-ASCII query is matched case-sensitively here. Trigram cannot serve
      // queries this short; fold in JS over a bounded title scan if it matters.
      if (titleOnly) {
        rows = await queryIndexRows(
          projectIds,
          `SELECT kind, item_id, project_id, title, body, 0 AS rank
           FROM search_index
           WHERE instr(lower(title), lower(?)) > 0`,
          [trimmed],
          trimmed,
          candidateLimit,
        );
      } else {
        rows = await queryIndexRows(
          projectIds,
          `SELECT kind, item_id, project_id, title, body, bm25(search_index, 1.0, 1.0, 1.0, 10.0, 1.0) AS rank
           FROM search_index
           WHERE search_index MATCH ?`,
          [fts5MatchExpression(trimmed)],
          trimmed,
          candidateLimit,
        );
      }

      pushMatches(rows, trimmed, titleOnly, limit, result);
      return result;
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
