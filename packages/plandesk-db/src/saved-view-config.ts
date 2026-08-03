/**
 * Canonical types for list-view filter / sort / group specs and the persisted
 * SavedViewConfig shape. Web evaluation helpers import these types; the API
 * validates writes with {@link parseSavedViewConfig}.
 *
 * `version` is a discriminant for future migrations of the stored JSON — not a
 * compatibility shim. Bump it only when the shape changes and add a reader path.
 */

export type SortableField =
  | 'label'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'due_date'
  | 'created_at'
  | 'updated_at';

export type SortSpec = {
  field: SortableField;
  direction: 'asc' | 'desc';
};

export const SORTABLE_FIELDS: readonly SortableField[] = [
  'label',
  'status',
  'priority',
  'assignee',
  'due_date',
  'created_at',
  'updated_at',
] as const;

export type GroupableField =
  | 'status'
  | 'goal_id'
  | 'lane'
  | 'severity'
  | 'assignee'
  | 'priority'
  | 'blocked'
  | 'tag';

export type GroupSpec = {
  field: GroupableField;
  direction: 'asc' | 'desc';
};

export type GroupSpecs = [GroupSpec] | [GroupSpec, GroupSpec];

export const GROUPABLE_FIELDS: readonly GroupableField[] = [
  'status',
  'goal_id',
  'lane',
  'severity',
  'assignee',
  'priority',
  'blocked',
  'tag',
] as const;

export type FilterableField =
  | 'label'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'tags'
  | 'lane'
  | 'due_date'
  | 'created_at'
  | 'updated_at'
  | 'goal_id'
  | 'blocked';

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after';

export type FilterNode =
  | { kind: 'group'; op: 'and' | 'or'; children: FilterNode[] }
  | { kind: 'condition'; field: FilterableField; operator: FilterOperator; value: unknown };

/**
 * Single source of truth for which operators a field accepts. The filter UI and
 * write-time validator both read this table.
 */
export const FIELD_OPERATORS: Record<FilterableField, readonly FilterOperator[]> = {
  label: ['is', 'is_not', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  status: ['is', 'is_not'],
  priority: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  assignee: ['is', 'is_not', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  tags: ['contains', 'does_not_contain', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  lane: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  due_date: ['is', 'is_not', 'before', 'after', 'is_empty', 'is_not_empty'],
  created_at: ['is', 'is_not', 'before', 'after'],
  updated_at: ['is', 'is_not', 'before', 'after'],
  goal_id: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  blocked: ['is', 'is_not', 'is_empty', 'is_not_empty'],
};

export const FILTERABLE_FIELDS: readonly FilterableField[] = [
  'label',
  'status',
  'priority',
  'assignee',
  'tags',
  'lane',
  'due_date',
  'created_at',
  'updated_at',
  'goal_id',
  'blocked',
] as const;

/** Stored payload version. Bump when the JSON shape changes. */
export const SAVED_VIEW_CONFIG_VERSION = 1 as const;

/**
 * Single definition of a saved view's shape. CSV/XLSX export and the web list
 * view consume this exact type — do not fork a second version elsewhere.
 */
export type SavedViewConfig = {
  version: typeof SAVED_VIEW_CONFIG_VERSION;
  filter: FilterNode | null;
  sort: SortSpec[];
  group: GroupSpecs | null;
  visibleColumns: string[];
};

export class InvalidSavedViewConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSavedViewConfigError';
  }
}

const MAX_FILTER_DEPTH = 16;
const MAX_SORT_SPECS = 8;
const MAX_VISIBLE_COLUMNS = 64;

const SORTABLE_FIELD_SET = new Set<string>(SORTABLE_FIELDS);
const GROUPABLE_FIELD_SET = new Set<string>(GROUPABLE_FIELDS);
const FILTERABLE_FIELD_SET = new Set<string>(FILTERABLE_FIELDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDirection(value: unknown): value is 'asc' | 'desc' {
  return value === 'asc' || value === 'desc';
}

function parseSortSpec(value: unknown, index: number): SortSpec {
  const at = String(index);
  if (!isRecord(value)) {
    throw new InvalidSavedViewConfigError(`sort[${at}] must be an object`);
  }
  if (typeof value.field !== 'string' || !SORTABLE_FIELD_SET.has(value.field)) {
    throw new InvalidSavedViewConfigError(`sort[${at}].field is invalid`);
  }
  if (!isDirection(value.direction)) {
    throw new InvalidSavedViewConfigError(`sort[${at}].direction must be asc or desc`);
  }
  return { field: value.field as SortableField, direction: value.direction };
}

function parseGroupSpec(value: unknown, index: number): GroupSpec {
  const at = String(index);
  if (!isRecord(value)) {
    throw new InvalidSavedViewConfigError(`group[${at}] must be an object`);
  }
  if (typeof value.field !== 'string' || !GROUPABLE_FIELD_SET.has(value.field)) {
    throw new InvalidSavedViewConfigError(`group[${at}].field is invalid`);
  }
  if (!isDirection(value.direction)) {
    throw new InvalidSavedViewConfigError(`group[${at}].direction must be asc or desc`);
  }
  return { field: value.field as GroupableField, direction: value.direction };
}

function parseFilterNode(value: unknown, depth: number): FilterNode {
  if (depth > MAX_FILTER_DEPTH) {
    throw new InvalidSavedViewConfigError(
      `filter exceeds max depth of ${String(MAX_FILTER_DEPTH)}`,
    );
  }
  if (!isRecord(value)) {
    throw new InvalidSavedViewConfigError('filter node must be an object');
  }
  if (value.kind === 'group') {
    if (value.op !== 'and' && value.op !== 'or') {
      throw new InvalidSavedViewConfigError('filter group.op must be and or or');
    }
    if (!Array.isArray(value.children)) {
      throw new InvalidSavedViewConfigError('filter group.children must be an array');
    }
    return {
      kind: 'group',
      op: value.op,
      children: value.children.map((child) => parseFilterNode(child, depth + 1)),
    };
  }
  if (value.kind === 'condition') {
    if (typeof value.field !== 'string' || !FILTERABLE_FIELD_SET.has(value.field)) {
      throw new InvalidSavedViewConfigError('filter condition.field is invalid');
    }
    const field = value.field as FilterableField;
    if (typeof value.operator !== 'string') {
      throw new InvalidSavedViewConfigError('filter condition.operator is invalid');
    }
    const allowed = FIELD_OPERATORS[field];
    if (!(allowed as readonly string[]).includes(value.operator)) {
      throw new InvalidSavedViewConfigError(
        `filter condition.operator ${value.operator} is not valid for ${field}`,
      );
    }
    if (!('value' in value)) {
      throw new InvalidSavedViewConfigError('filter condition.value is required');
    }
    return {
      kind: 'condition',
      field,
      operator: value.operator as FilterOperator,
      value: value.value,
    };
  }
  throw new InvalidSavedViewConfigError('filter node.kind must be group or condition');
}

/** Parse a filter tree from JSON (URL param or API body). Returns null when invalid. */
export function parseFilterJson(raw: unknown): FilterNode | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw === '') {
      return null;
    }
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  try {
    return parseFilterNode(value, 0);
  } catch {
    return null;
  }
}

/**
 * Parse and validate a SavedViewConfig. Rejects malformed shapes — never stores
 * them. Accepts either a parsed object or a JSON string.
 */
export function parseSavedViewConfig(raw: unknown): SavedViewConfig {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new InvalidSavedViewConfigError('config must be valid JSON');
    }
  }
  if (!isRecord(value)) {
    throw new InvalidSavedViewConfigError('config must be an object');
  }
  if (value.version !== SAVED_VIEW_CONFIG_VERSION) {
    throw new InvalidSavedViewConfigError(
      `config.version must be ${String(SAVED_VIEW_CONFIG_VERSION)}`,
    );
  }
  if (!('filter' in value)) {
    throw new InvalidSavedViewConfigError('config.filter is required');
  }
  const filter =
    value.filter === null ? null : parseFilterNode(value.filter, 0);

  if (!Array.isArray(value.sort)) {
    throw new InvalidSavedViewConfigError('config.sort must be an array');
  }
  if (value.sort.length > MAX_SORT_SPECS) {
    throw new InvalidSavedViewConfigError(
      `config.sort exceeds max of ${String(MAX_SORT_SPECS)}`,
    );
  }
  const sort = value.sort.map((spec, index) => parseSortSpec(spec, index));

  let group: GroupSpecs | null = null;
  if (value.group === null) {
    group = null;
  } else if (!Array.isArray(value.group)) {
    throw new InvalidSavedViewConfigError('config.group must be a 1–2 item array or null');
  } else if (value.group.length === 1) {
    group = [parseGroupSpec(value.group[0], 0)];
  } else if (value.group.length === 2) {
    group = [parseGroupSpec(value.group[0], 0), parseGroupSpec(value.group[1], 1)];
  } else {
    throw new InvalidSavedViewConfigError('config.group must have one or two levels');
  }

  if (!Array.isArray(value.visibleColumns)) {
    throw new InvalidSavedViewConfigError('config.visibleColumns must be an array');
  }
  if (value.visibleColumns.length > MAX_VISIBLE_COLUMNS) {
    throw new InvalidSavedViewConfigError(
      `config.visibleColumns exceeds max of ${String(MAX_VISIBLE_COLUMNS)}`,
    );
  }
  const visibleColumns: string[] = [];
  for (let i = 0; i < value.visibleColumns.length; i += 1) {
    const col: unknown = value.visibleColumns[i];
    if (typeof col !== 'string' || col.trim() === '') {
      throw new InvalidSavedViewConfigError(
        `config.visibleColumns[${String(i)}] must be a non-empty string`,
      );
    }
    visibleColumns.push(col);
  }

  return {
    version: SAVED_VIEW_CONFIG_VERSION,
    filter,
    sort,
    group,
    visibleColumns,
  };
}

/** Serialize a validated config for the `views.config` text column. */
export function stringifySavedViewConfig(config: SavedViewConfig): string {
  return JSON.stringify(config);
}

/**
 * Canonical non-trivial config for golden fixtures and round-trip tests:
 * nested filter, two-level sort, two-level group, and a column set.
 */
export const NON_TRIVIAL_SAVED_VIEW_CONFIG: SavedViewConfig = {
  version: SAVED_VIEW_CONFIG_VERSION,
  filter: {
    kind: 'group',
    op: 'and',
    children: [
      {
        kind: 'condition',
        field: 'status',
        operator: 'is',
        value: 'blocked',
      },
      {
        kind: 'group',
        op: 'or',
        children: [
          {
            kind: 'condition',
            field: 'priority',
            operator: 'is',
            value: 'urgent',
          },
          {
            kind: 'condition',
            field: 'tags',
            operator: 'contains',
            value: 'p0',
          },
        ],
      },
    ],
  },
  sort: [
    { field: 'priority', direction: 'desc' },
    { field: 'due_date', direction: 'asc' },
  ],
  group: [
    { field: 'goal_id', direction: 'asc' },
    { field: 'status', direction: 'asc' },
  ],
  visibleColumns: ['label', 'status', 'priority', 'assignee', 'due_date'],
};
