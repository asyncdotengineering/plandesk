import { BookmarkIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SerializedView } from '../../lib/api.js';

type SavedViewsMenuProps = {
  views: SerializedView[];
  activeViewId?: string;
  onSelect: (view: SerializedView) => void;
  onSave: (name: string) => void;
  onRename: (viewId: string, name: string) => void;
  onDelete: (viewId: string) => void;
  isSaving?: boolean;
};

export function SavedViewsMenu({
  views,
  activeViewId,
  onSelect,
  onSave,
  onRename,
  onDelete,
  isSaving = false,
}: SavedViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const submitSave = () => {
    const trimmed = draftName.trim();
    if (trimmed === '') {
      return;
    }
    onSave(trimmed);
    setDraftName('');
    setOpen(false);
  };

  const submitRename = (viewId: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed === '') {
      return;
    }
    onRename(viewId, trimmed);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Saved views"
        aria-expanded={open}
        aria-controls="saved-views-panel"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <BookmarkIcon className="size-3.5" />
        Views
        {activeViewId !== undefined ? (
          <span className="text-muted-foreground" data-active-view-id={activeViewId}>
            1
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          id="saved-views-panel"
          role="dialog"
          aria-label="Saved views"
          data-saved-views-panel
          className="absolute right-0 z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <p className="px-1 py-1.5 text-xs font-medium">Saved views</p>
          <div className="my-1 h-px bg-border" />
          {views.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground" data-saved-views-empty>
              No saved views yet.
            </p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-auto" data-saved-views-list>
              {views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  {renamingId === view.id ? (
                    <>
                      <input
                        aria-label={`Rename view ${view.name}`}
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                        value={renameDraft}
                        onChange={(event) => {
                          setRenameDraft(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            submitRename(view.id);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        aria-label="Confirm rename"
                        onClick={() => {
                          submitRename(view.id);
                        }}
                      >
                        Save
                      </Button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-saved-view-id={view.id}
                        data-saved-view-active={activeViewId === view.id ? 'true' : 'false'}
                        className="min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          onSelect(view);
                          setOpen(false);
                        }}
                      >
                        {view.name}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        aria-label={`Rename ${view.name}`}
                        onClick={() => {
                          setRenamingId(view.id);
                          setRenameDraft(view.name);
                        }}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        aria-label={`Delete ${view.name}`}
                        onClick={() => {
                          onDelete(view.id);
                        }}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="my-1 h-px bg-border" />
          <div className="flex gap-1 px-1">
            <input
              aria-label="New view name"
              placeholder="View name"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitSave();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 px-2 text-xs"
              aria-label="Save current view"
              disabled={isSaving || draftName.trim() === ''}
              onClick={submitSave}
            >
              <PlusIcon className="size-3.5" />
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
