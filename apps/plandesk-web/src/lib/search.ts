import { SORTABLE_FIELDS, type SortSpec } from '@plandesk/db/saved-view-config';
import { taskStatuses, type TaskStatus } from './api.js';
import { LIST_COLUMNS, type ListColumnId } from '../components/board/list-columns.js';

const SORTABLE_FIELD_SET = new Set<string>(SORTABLE_FIELDS);
const LIST_COLUMN_SET = new Set<string>(LIST_COLUMNS);

export type TaskFilterSearch = {
  status?: TaskStatus;
  /**
   * Task to open in the drawer. Makes a task addressable: without it the drawer
   * is component state only, so nothing elsewhere in the app — a document's
   * links, a share link, a pasted URL — can point at a specific task.
   */
  task?: string;
  /** Multi-level sort encoded as `field:dir,field:dir` (list view). */
  sort?: SortSpec[];
  /** Visible list columns encoded as a comma-separated id list (list view). */
  columns?: ListColumnId[];
};

function parseSortParam(value: unknown): SortSpec[] | undefined {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  const specs: SortSpec[] = [];
  for (const segment of value.split(',')) {
    const trimmed = segment.trim();
    if (trimmed === '') {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const field = trimmed.slice(0, colon);
    const direction = trimmed.slice(colon + 1);
    if (!SORTABLE_FIELD_SET.has(field)) {
      continue;
    }
    if (direction !== 'asc' && direction !== 'desc') {
      continue;
    }
    specs.push({ field: field as SortSpec['field'], direction });
  }
  return specs.length > 0 ? specs : undefined;
}

function parseColumnsParam(value: unknown): ListColumnId[] | undefined {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  const columns: ListColumnId[] = [];
  for (const segment of value.split(',')) {
    const trimmed = segment.trim();
    if (trimmed === '' || !LIST_COLUMN_SET.has(trimmed)) {
      continue;
    }
    columns.push(trimmed as ListColumnId);
  }
  return columns.length > 0 ? columns : undefined;
}

/** Serialize sort specs for a list-view search param. Omits when empty. */
export function encodeSortParam(specs: SortSpec[]): string | undefined {
  if (specs.length === 0) {
    return undefined;
  }
  return specs.map((spec) => `${spec.field}:${spec.direction}`).join(',');
}

/** Serialize visible columns for a list-view search param. Omits when empty. */
export function encodeColumnsParam(columns: Iterable<ListColumnId>): string | undefined {
  const ids = [...columns];
  if (ids.length === 0) {
    return undefined;
  }
  return ids.join(',');
}

export function validateTaskFilterSearch(search: Record<string, unknown>): TaskFilterSearch {
  const result: TaskFilterSearch = {};

  const status = search.status;
  if (typeof status === 'string' && (taskStatuses as readonly string[]).includes(status)) {
    result.status = status as TaskStatus;
  }

  const task = search.task;
  if (typeof task === 'string' && task !== '') {
    result.task = task;
  }

  const sort = parseSortParam(search.sort);
  if (sort !== undefined) {
    result.sort = sort;
  }

  const columns = parseColumnsParam(search.columns);
  if (columns !== undefined) {
    result.columns = columns;
  }

  return result;
}
