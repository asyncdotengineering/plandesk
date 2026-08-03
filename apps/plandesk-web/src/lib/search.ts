import {
  GROUPABLE_FIELDS,
  SORTABLE_FIELDS,
  parseFilterJson,
  type FilterNode,
  type GroupSpec,
  type SortSpec,
} from '@plandesk/db/saved-view-config';
import { taskStatuses, type TaskStatus } from './api.js';
import { LIST_COLUMNS, type ListColumnId } from '../components/board/list-columns.js';

const SORTABLE_FIELD_SET = new Set<string>(SORTABLE_FIELDS);
const GROUPABLE_FIELD_SET = new Set<string>(GROUPABLE_FIELDS);
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
  /** Nested filter tree as JSON (list view). */
  filter?: FilterNode;
  /** Group levels encoded as `field:dir,field:dir` (list view). */
  group?: GroupSpec[];
  /** Active saved view id (list view). */
  view?: string;
};

/**
 * A search param reaches us in one of two shapes, and both are legitimate.
 *
 * A hand-written or shared URL carries the compact wire form
 * (`field:dir,field:dir`). A `navigate({ search })` call carries the decoded
 * value, because TanStack types that argument against this validator's OUTPUT
 * and round-trips it through its own serializer.
 *
 * `parseFilterJson` already accepts both; these parsers do the same, so a value
 * survives a navigate → URL → parse round trip instead of being dropped for
 * arriving already-decoded.
 */
function isSpecShape(entry: unknown, allowedFields: ReadonlySet<string>): boolean {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const { field, direction } = entry as { field?: unknown; direction?: unknown };
  return (
    typeof field === 'string' &&
    allowedFields.has(field) &&
    (direction === 'asc' || direction === 'desc')
  );
}

function asSpecArray<T>(value: unknown, isSpec: (entry: unknown) => entry is T): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const specs = value.filter(isSpec);
  return specs.length > 0 ? specs : undefined;
}

function parseGroupParam(value: unknown): GroupSpec[] | undefined {
  const decoded = asSpecArray(
    value,
    (entry): entry is GroupSpec => isSpecShape(entry, GROUPABLE_FIELD_SET),
  );
  if (decoded !== undefined) {
    return decoded;
  }
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  const specs: GroupSpec[] = [];
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
    if (!GROUPABLE_FIELD_SET.has(field)) {
      continue;
    }
    if (direction !== 'asc' && direction !== 'desc') {
      continue;
    }
    specs.push({ field: field as GroupSpec['field'], direction });
  }
  return specs.length > 0 ? specs : undefined;
}

function parseSortParam(value: unknown): SortSpec[] | undefined {
  const decoded = asSpecArray(
    value,
    (entry): entry is SortSpec => isSpecShape(entry, SORTABLE_FIELD_SET),
  );
  if (decoded !== undefined) {
    return decoded;
  }
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
  if (Array.isArray(value)) {
    const ids = value.filter(
      (entry): entry is ListColumnId => typeof entry === 'string' && LIST_COLUMN_SET.has(entry),
    );
    return ids.length > 0 ? ids : undefined;
  }
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

/** Serialize group specs for a list-view search param. Omits when empty. */
export function encodeGroupParam(specs: GroupSpec[]): string | undefined {
  if (specs.length === 0) {
    return undefined;
  }
  return specs.map((spec) => `${spec.field}:${spec.direction}`).join(',');
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

/** Serialize a filter tree for a list-view search param. Omits when null. */
export function encodeFilterParam(node: FilterNode | null): string | undefined {
  if (node === null) {
    return undefined;
  }
  return JSON.stringify(node);
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

  const filter = parseFilterJson(search.filter);
  if (filter !== null) {
    result.filter = filter;
  }

  const group = parseGroupParam(search.group);
  if (group !== undefined) {
    result.group = group;
  }

  const view = search.view;
  if (typeof view === 'string' && view !== '') {
    result.view = view;
  }

  return result;
}
