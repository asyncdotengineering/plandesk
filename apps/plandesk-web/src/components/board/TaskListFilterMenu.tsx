import { FilterIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { taskPriorities, taskStatuses } from '../../lib/api.js';
import {
  FILTER_OPERATOR_LABELS,
  FILTERABLE_FIELD_LABELS,
  FILTERABLE_FIELDS,
  countFilterConditions,
  defaultCondition,
  defaultOperatorForField,
  emptyFilterGroup,
  operatorNeedsValue,
  operatorsForField,
  type FilterNode,
  type FilterOperator,
  type FilterableField,
} from './task-filter.js';

const LANE_VALUES = ['auto', 'approve', 'full'] as const;

type TaskListFilterMenuProps = {
  root: FilterNode | null;
  onChange: (root: FilterNode | null) => void;
  tagSuggestions?: string[];
};

function updateChild(
  group: Extract<FilterNode, { kind: 'group' }>,
  index: number,
  next: FilterNode,
): FilterNode {
  return {
    ...group,
    children: group.children.map((child, i) => (i === index ? next : child)),
  };
}

function removeChild(group: Extract<FilterNode, { kind: 'group' }>, index: number): FilterNode {
  return {
    ...group,
    children: group.children.filter((_, i) => i !== index),
  };
}

function appendChild(group: Extract<FilterNode, { kind: 'group' }>, child: FilterNode): FilterNode {
  return { ...group, children: [...group.children, child] };
}

function ConditionEditor({
  node,
  onChange,
  onRemove,
  pathLabel,
  tagSuggestions,
}: {
  node: Extract<FilterNode, { kind: 'condition' }>;
  onChange: (node: FilterNode) => void;
  onRemove: () => void;
  pathLabel: string;
  tagSuggestions: string[];
}) {
  const operators = operatorsForField(node.field);
  const needsValue = operatorNeedsValue(node.operator);

  const setField = (field: FilterableField) => {
    // Always reset the operator on field change so tags land on `contains`
    // (and date/text fields do not keep a stale operator from the previous field).
    onChange({
      kind: 'condition',
      field,
      operator: defaultOperatorForField(field),
      value: field === 'status' ? 'todo' : field === 'priority' ? 'medium' : '',
    });
  };

  const setOperator = (operator: FilterOperator) => {
    onChange({
      ...node,
      operator,
      value: operatorNeedsValue(operator) ? node.value : null,
    });
  };

  return (
    <div
      data-filter-condition={pathLabel}
      className="flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-background p-1.5"
    >
      <select
        aria-label={`Filter field ${pathLabel}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
        value={node.field}
        onChange={(event) => {
          setField(event.target.value as FilterableField);
        }}
      >
        {FILTERABLE_FIELDS.map((field) => (
          <option key={field} value={field}>
            {FILTERABLE_FIELD_LABELS[field]}
          </option>
        ))}
      </select>
      <select
        aria-label={`Filter operator ${pathLabel}`}
        data-filter-operator-select={pathLabel}
        className="h-8 min-w-[7rem] rounded-md border border-input bg-transparent px-2 text-xs"
        value={node.operator}
        onChange={(event) => {
          setOperator(event.target.value as FilterOperator);
        }}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {FILTER_OPERATOR_LABELS[operator]}
          </option>
        ))}
      </select>
      {needsValue ? (
        <FilterValueInput
          field={node.field}
          value={node.value}
          pathLabel={pathLabel}
          tagSuggestions={tagSuggestions}
          onChange={(value) => {
            onChange({ ...node, value });
          }}
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-8 p-0"
        aria-label={`Remove condition ${pathLabel}`}
        onClick={onRemove}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  );
}

function FilterValueInput({
  field,
  value,
  pathLabel,
  tagSuggestions,
  onChange,
}: {
  field: FilterableField;
  value: unknown;
  pathLabel: string;
  tagSuggestions: string[];
  onChange: (value: unknown) => void;
}) {
  const stringValue =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';

  if (field === 'status') {
    return (
      <select
        aria-label={`Filter value ${pathLabel}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stringValue}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {taskStatuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    );
  }

  if (field === 'priority') {
    return (
      <select
        aria-label={`Filter value ${pathLabel}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stringValue}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {taskPriorities.map((priority) => (
          <option key={priority} value={priority}>
            {priority}
          </option>
        ))}
      </select>
    );
  }

  if (field === 'lane') {
    return (
      <select
        aria-label={`Filter value ${pathLabel}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stringValue}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {LANE_VALUES.map((lane) => (
          <option key={lane} value={lane}>
            {lane}
          </option>
        ))}
      </select>
    );
  }

  if (field === 'blocked') {
    return (
      <select
        aria-label={`Filter value ${pathLabel}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stringValue === 'true' || stringValue === 'false' ? stringValue : 'true'}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="true">Blocked</option>
        <option value="false">Not blocked</option>
      </select>
    );
  }

  if (field === 'due_date' || field === 'created_at' || field === 'updated_at') {
    return (
      <input
        type="date"
        aria-label={`Filter value ${pathLabel}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stringValue.slice(0, 10)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  return (
    <input
      type="text"
      list={
        field === 'tags' && tagSuggestions.length > 0 ? 'filter-tag-suggestions-root' : undefined
      }
      aria-label={`Filter value ${pathLabel}`}
      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
      value={stringValue}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

function GroupEditor({
  node,
  onChange,
  onRemove,
  pathLabel,
  depth,
  tagSuggestions,
}: {
  node: Extract<FilterNode, { kind: 'group' }>;
  onChange: (node: FilterNode) => void;
  onRemove: (() => void) | null;
  pathLabel: string;
  depth: number;
  tagSuggestions: string[];
}) {
  return (
    <div
      data-filter-group={pathLabel}
      data-filter-depth={depth}
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2"
    >
      <div className="flex items-center gap-1">
        <select
          aria-label={`Filter group op ${pathLabel}`}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-medium uppercase"
          value={node.op}
          onChange={(event) => {
            onChange({ ...node, op: event.target.value as 'and' | 'or' });
          }}
        >
          <option value="and">And</option>
          <option value="or">Or</option>
        </select>
        <span className="flex-1 text-xs text-muted-foreground">
          {node.children.length === 0
            ? 'Matches everything'
            : `${String(node.children.length)} rules`}
        </span>
        {onRemove !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            aria-label={`Remove group ${pathLabel}`}
            onClick={onRemove}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {node.children.map((child, index) => {
        const childPath = `${pathLabel}.${String(index)}`;
        if (child.kind === 'condition') {
          return (
            <ConditionEditor
              key={childPath}
              node={child}
              pathLabel={childPath}
              tagSuggestions={tagSuggestions}
              onChange={(next) => {
                onChange(updateChild(node, index, next));
              }}
              onRemove={() => {
                onChange(removeChild(node, index));
              }}
            />
          );
        }
        return (
          <GroupEditor
            key={childPath}
            node={child}
            pathLabel={childPath}
            depth={depth + 1}
            tagSuggestions={tagSuggestions}
            onChange={(next) => {
              onChange(updateChild(node, index, next));
            }}
            onRemove={() => {
              onChange(removeChild(node, index));
            }}
          />
        );
      })}

      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-start"
          aria-label={`Add condition to ${pathLabel}`}
          onClick={() => {
            onChange(appendChild(node, defaultCondition()));
          }}
        >
          <PlusIcon className="size-3.5" />
          Add condition
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-start"
          aria-label={`Add group to ${pathLabel}`}
          onClick={() => {
            onChange(appendChild(node, emptyFilterGroup('or')));
          }}
        >
          <PlusIcon className="size-3.5" />
          Add group
        </Button>
      </div>
    </div>
  );
}

export function TaskListFilterMenu({
  root,
  onChange,
  tagSuggestions = [],
}: TaskListFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const activeRoot = root !== null && root.kind === 'group' ? root : emptyFilterGroup('and');
  const conditionCount = countFilterConditions(root);

  // datalist for tag suggestions (shared id when panel is open)
  const tagListId = 'filter-tag-suggestions-root';

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Filter"
        aria-expanded={open}
        aria-controls="task-list-filter-panel"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <FilterIcon className="size-3.5" />
        Filter
        {conditionCount > 0 ? (
          <span className="text-muted-foreground" data-filter-count>
            {conditionCount}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          id="task-list-filter-panel"
          role="dialog"
          aria-label="Filter rules"
          data-filter-panel
          className="absolute right-0 z-20 mt-1 w-[28rem] max-w-[min(28rem,calc(100vw-2rem))] rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <div className="flex items-center justify-between gap-2 px-1 py-1.5">
            <p className="text-xs font-medium">Filter</p>
            {root !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                aria-label="Clear filter"
                onClick={() => {
                  onChange(null);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <div className="my-1 h-px bg-border" />
          {tagSuggestions.length > 0 ? (
            <datalist id={tagListId}>
              {tagSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ) : null}
          <GroupEditor
            node={activeRoot}
            pathLabel="root"
            depth={0}
            tagSuggestions={tagSuggestions}
            onRemove={null}
            onChange={(next) => {
              onChange(next);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
