import {
  ArrowDownIcon,
  ArrowUpIcon,
  LayersIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  GROUPABLE_FIELD_LABELS,
  GROUPABLE_FIELDS,
  type GroupSpec,
  type GroupSpecs,
  type GroupableField,
} from './task-group.js';

type TaskListGroupMenuProps = {
  specs: GroupSpec[];
  onChange: (specs: GroupSpec[]) => void;
};

function nextDefaultField(specs: GroupSpec[]): GroupableField {
  const used = new Set(specs.map((spec) => spec.field));
  return GROUPABLE_FIELDS.find((field) => !used.has(field)) ?? 'status';
}

/** Clamp to the two-level tuple the grouping type allows. */
export function toGroupSpecs(specs: GroupSpec[]): GroupSpecs | null {
  const first = specs[0];
  if (first === undefined) {
    return null;
  }
  const second = specs[1];
  if (second === undefined) {
    return [first];
  }
  return [first, second];
}

export function TaskListGroupMenu({ specs, onChange }: TaskListGroupMenuProps) {
  const [open, setOpen] = useState(false);

  const updateAt = (index: number, patch: Partial<GroupSpec>) => {
    onChange(specs.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= specs.length) {
      return;
    }
    const next = specs.slice();
    const removed = next.splice(index, 1);
    const item = removed[0];
    if (item === undefined) {
      return;
    }
    next.splice(target, 0, item);
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(specs.filter((_, i) => i !== index));
  };

  const addLevel = () => {
    if (specs.length >= 2) {
      return;
    }
    onChange([...specs, { field: nextDefaultField(specs), direction: 'asc' }]);
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Group"
        aria-expanded={open}
        aria-controls="task-list-group-panel"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <LayersIcon className="size-3.5" />
        Group
        {specs.length > 0 ? (
          <span className="text-muted-foreground" data-group-count>
            {specs.length}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          id="task-list-group-panel"
          role="dialog"
          aria-label="Group levels"
          data-group-panel
          className="absolute right-0 z-20 mt-1 w-80 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <p className="px-1 py-1.5 text-xs font-medium">Group levels</p>
          <div className="my-1 h-px bg-border" />
          {specs.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground" data-group-empty>
              No grouping. Rows stay flat.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-group-levels>
              {specs.map((spec, index) => {
                const level = String(index + 1);
                return (
                  <li
                    key={`${spec.field}-${String(index)}`}
                    data-group-level={index}
                    className="flex items-center gap-1"
                  >
                    <select
                      aria-label={`Group field ${level}`}
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={spec.field}
                      onChange={(event) => {
                        updateAt(index, { field: event.target.value as GroupableField });
                      }}
                    >
                      {GROUPABLE_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {GROUPABLE_FIELD_LABELS[field]}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      aria-label={`Group direction ${level}`}
                      onClick={() => {
                        updateAt(index, {
                          direction: spec.direction === 'asc' ? 'desc' : 'asc',
                        });
                      }}
                    >
                      {spec.direction === 'asc' ? 'Asc' : 'Desc'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      aria-label={`Move group level ${level} up`}
                      disabled={index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      <ArrowUpIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      aria-label={`Move group level ${level} down`}
                      disabled={index === specs.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      <ArrowDownIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      aria-label={`Remove group level ${level}`}
                      onClick={() => {
                        removeAt(index);
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="my-1 h-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            aria-label="Add group level"
            disabled={specs.length >= 2}
            onClick={addLevel}
          >
            <PlusIcon className="size-3.5" />
            Add group level
          </Button>
        </div>
      ) : null}
    </div>
  );
}
