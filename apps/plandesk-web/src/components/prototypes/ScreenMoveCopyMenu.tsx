import { useState } from 'react';
import { toast } from 'sonner';
import { useCopyScreen, useMoveScreen, usePrototypes } from '@/lib/queries.js';

/**
 * Move / copy a screen to another prototype in the same project.
 * Arrange-mode chrome only — guests never see this.
 */
export function ScreenMoveCopyMenu({
  artifactId,
  projectId,
  currentPrototypeId,
}: {
  artifactId: string;
  projectId: string;
  currentPrototypeId: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: prototypes } = usePrototypes(projectId);
  const move = useMoveScreen(currentPrototypeId);
  const copy = useCopyScreen(currentPrototypeId);
  const others = (prototypes ?? []).filter((p) => p.id !== currentPrototypeId);

  if (others.length === 0) {
    return null;
  }

  return (
    <div className="nodrag nopan absolute right-2 top-1 z-20" data-screen-move-copy>
      <button
        type="button"
        className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Move / Copy
      </button>
      {open ? (
        <ul className="absolute right-0 mt-1 max-h-48 w-48 overflow-auto rounded border border-border bg-card p-1 text-[11px] shadow-md">
          {others.map((proto) => (
            <li
              key={proto.id}
              className="flex flex-col gap-0.5 border-b border-border/50 py-1 last:border-0"
            >
              <span className="truncate px-1.5 font-medium">{proto.name}</span>
              <div className="flex gap-1 px-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 hover:bg-muted"
                  disabled={move.isPending || copy.isPending}
                  onClick={() => {
                    move.mutate(
                      { id: artifactId, prototypeId: proto.id },
                      {
                        onSuccess: () => {
                          toast(`Moved to ${proto.name}`);
                          setOpen(false);
                        },
                        onError: (err) => {
                          toast(err instanceof Error ? err.message : 'Move failed');
                        },
                      },
                    );
                  }}
                >
                  Move
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 hover:bg-muted"
                  disabled={move.isPending || copy.isPending}
                  onClick={() => {
                    copy.mutate(
                      { id: artifactId, prototypeId: proto.id },
                      {
                        onSuccess: () => {
                          toast(`Copied to ${proto.name}`);
                          setOpen(false);
                        },
                        onError: (err) => {
                          toast(err instanceof Error ? err.message : 'Copy failed');
                        },
                      },
                    );
                  }}
                >
                  Copy
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
