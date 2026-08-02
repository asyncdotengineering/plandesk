import { useMemo, useState } from 'react';
import type { SerializedFolder } from '../../lib/api.js';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const UNFILED_PICKER_VALUE = '__unfiled__';

/** Breadcrumb-style path for a folder (e.g. "Specs / Archive"). */
export function folderNestingPath(
  folders: SerializedFolder[],
  folderId: string,
): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor !== null) {
    if (visited.has(cursor)) {
      break;
    }
    visited.add(cursor);
    const folder = byId.get(cursor);
    if (folder === undefined) {
      break;
    }
    parts.unshift(folder.name);
    cursor = folder.parent_folder_id;
  }
  return parts.join(' / ');
}

export type FolderPickerProps = {
  id?: string;
  label?: string;
  folders: SerializedFolder[];
  /** Current choice: folder id, or null for Unfiled. */
  value: string | null;
  onChange: (folderId: string | null) => void;
  /** Folder ids that must not appear (e.g. a folder cannot move into itself). */
  excludeIds?: ReadonlySet<string>;
  /** Include the Unfiled option (default true). */
  allowUnfiled?: boolean;
};

/**
 * Filterable folder destination picker. Shows each folder's nesting path;
 * typing narrows by name or path.
 */
export function FolderPicker({
  id = 'folder-picker',
  label = 'Destination',
  folders,
  value,
  onChange,
  excludeIds,
  allowUnfiled = true,
}: FolderPickerProps) {
  const [filter, setFilter] = useState('');
  const normalized = filter.trim().toLowerCase();

  const options = useMemo(() => {
    const rows = folders
      .filter((folder) => excludeIds === undefined || !excludeIds.has(folder.id))
      .map((folder) => ({
        id: folder.id,
        path: folderNestingPath(folders, folder.id),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (normalized === '') {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.path.toLowerCase().includes(normalized) ||
        row.id.toLowerCase().includes(normalized),
    );
  }, [folders, excludeIds, normalized]);

  const selectValue = value ?? UNFILED_PICKER_VALUE;

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-filter`} className="text-xs text-muted-foreground">
          Filter folders
        </Label>
        <Input
          id={`${id}-filter`}
          value={filter}
          placeholder="Filter folders…"
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <select
          id={id}
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next === UNFILED_PICKER_VALUE ? null : next);
          }}
          className="flex min-h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          size={Math.min(8, Math.max(2, options.length + (allowUnfiled ? 1 : 0)))}
        >
          {allowUnfiled ? (
            <option value={UNFILED_PICKER_VALUE}>Unfiled (no folder)</option>
          ) : null}
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {row.path}
            </option>
          ))}
        </select>
      </div>
      {normalized !== '' && options.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No folders match.</p>
      ) : null}
    </div>
  );
}
