import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  SORTABLE_FIELD_LABELS,
  SORTABLE_FIELDS,
  type SortableField,
  type SortSpec,
} from './task-sort.js';

type TaskListSortMenuProps = {
  specs: SortSpec[];
  onChange: (specs: SortSpec[]) => void;
};

function nextDefaultField(specs: SortSpec[]): SortableField {
  const used = new Set(specs.map((spec) => spec.field));
  return SORTABLE_FIELDS.find((field) => !used.has(field)) ?? 'label';
}

export function TaskListSortMenu({ specs, onChange }: TaskListSortMenuProps) {
  const [open, setOpen] = useState(false);

  const updateAt = (index: number, patch: Partial<SortSpec>) => {
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
    onChange([...specs, { field: nextDefaultField(specs), direction: 'asc' }]);
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Sort"
        aria-expanded={open}
        aria-controls="task-list-sort-panel"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <ArrowUpDownIcon className="size-3.5" />
        Sort
        {specs.length > 0 ? (
          <span className="text-muted-foreground" data-sort-count>
            {specs.length}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          id="task-list-sort-panel"
          role="dialog"
          aria-label="Sort levels"
          data-sort-panel
          className="absolute right-0 z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <p className="px-1 py-1.5 text-xs font-medium">Sort levels</p>
          <div className="my-1 h-px bg-border" />
          {specs.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground" data-sort-empty>
              No sort applied. Rows keep fetch order.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-sort-levels>
              {specs.map((spec, index) => {
                const level = String(index + 1);
                return (
                  <li
                    key={`${spec.field}-${String(index)}`}
                    data-sort-level={index}
                    className="flex items-center gap-1"
                  >
                    <select
                      aria-label={`Sort field ${level}`}
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={spec.field}
                      onChange={(event) => {
                        updateAt(index, { field: event.target.value as SortableField });
                      }}
                    >
                      {SORTABLE_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {SORTABLE_FIELD_LABELS[field]}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      aria-label={`Sort direction ${level}`}
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
                      aria-label={`Move sort level ${level} up`}
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
                      aria-label={`Move sort level ${level} down`}
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
                      aria-label={`Remove sort level ${level}`}
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
            aria-label="Add sort level"
            onClick={addLevel}
          >
            <PlusIcon className="size-3.5" />
            Add sort level
          </Button>
        </div>
      ) : null}
    </div>
  );
}
