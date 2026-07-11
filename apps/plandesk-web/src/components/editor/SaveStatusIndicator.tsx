import { CheckIcon, LoaderIcon, TriangleAlertIcon } from 'lucide-react';
import type { SaveStatus } from './useAutosave.js';

// Quiet, Notion-style save affordance that replaces the manual Save button.
export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === 'unsaved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" /> Unsaved changes
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-destructive">
        <TriangleAlertIcon className="size-3.5" /> Couldn&rsquo;t save — retrying
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <CheckIcon className="size-3.5" /> Saved
    </span>
  );
}
