import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HistoryIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  diffRevision,
  getRevision,
  listRevisions,
  restoreRevision,
  type RevisionFieldDiff,
  type RevisionTargetType,
  type SerializedDocument,
  type SerializedRevision,
  type SerializedRevisionMeta,
  type SerializedTask,
} from '../../lib/api.js';
import { queryKeys } from '../../lib/queries.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ConfirmDialog } from '../docs/ConfirmDialog.js';

const RETENTION_COPY =
  'History is kept for the life of the record. Editing does not remove earlier versions. Deleting the record removes its history permanently.';

const TASK_VERSIONED_FIELDS = ['label', 'description'] as const;
const DOCUMENT_VERSIONED_FIELDS = ['title', 'body', 'status_line'] as const;
const ARTIFACT_VERSIONED_FIELDS = ['title', 'content', 'kind'] as const;

export function formatRevisionAuthor(author: string): string {
  if (author === 'system') {
    return 'System';
  }
  if (author.startsWith('human:')) {
    return author.slice('human:'.length);
  }
  if (author.startsWith('agent:')) {
    return `Agent ${author.slice('agent:'.length)}`;
  }
  return author;
}

export function relativeTime(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((nowMs - then) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${String(days)}d ago`;
}

function fieldLabel(field: string): string {
  if (field === 'status_line') {
    return 'status line';
  }
  return field;
}

function versionedFieldsFor(targetType: RevisionTargetType): readonly string[] {
  if (targetType === 'task') {
    return TASK_VERSIONED_FIELDS;
  }
  if (targetType === 'document') {
    return DOCUMENT_VERSIONED_FIELDS;
  }
  return ARTIFACT_VERSIONED_FIELDS;
}

function versionedFieldsPhrase(targetType: RevisionTargetType): string {
  const labels = versionedFieldsFor(targetType).map(fieldLabel);
  if (labels.length <= 1) {
    return labels.join('');
  }
  const last = labels[labels.length - 1] ?? '';
  const rest = labels.slice(0, -1).join(', ');
  if (labels.length === 2) {
    return `${rest} and ${last}`;
  }
  return `${rest}, and ${last}`;
}

function restoreConfirmDescription(targetType: RevisionTargetType): string {
  const fields = versionedFieldsPhrase(targetType);
  if (targetType === 'task') {
    return `Restore this version from content history? This will replace the current ${fields}. Status, position, and assignment will not change.`;
  }
  if (targetType === 'artifact') {
    return `Restore this version from content history? This will replace the current ${fields}. Prototype placement will not change.`;
  }
  return `Restore this version from content history? This will replace the current ${fields}. Folder and links will not change.`;
}

function snapshotText(snapshot: Record<string, unknown>, field: string): string {
  const value = snapshot[field];
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

type ContentHistoryPanelProps = {
  projectId: string;
  targetType: RevisionTargetType;
  targetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the live entity after a successful restore. */
  onRestored?: (entity: SerializedTask | SerializedDocument) => void;
};

export function ContentHistoryPanel({
  projectId,
  targetType,
  targetId,
  open,
  onOpenChange,
  onRestored,
}: ContentHistoryPanelProps) {
  const queryClient = useQueryClient();
  const [revisions, setRevisions] = useState<SerializedRevisionMeta[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<SerializedRevision | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [diffs, setDiffs] = useState<RevisionFieldDiff[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [listEpoch, setListEpoch] = useState(0);

  // Reset selection when the panel closes or the target changes.
  useEffect(() => {
    if (!open) {
      setSelectedIds([]);
      setSnapshot(null);
      setDiffs(null);
      setListError(null);
      setConfirmRestoreId(null);
    }
  }, [open, projectId, targetType, targetId]);

  // Eager list fetch when the panel opens — metadata only, no snapshots.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    void listRevisions(projectId, targetType, targetId)
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setRevisions(rows);
        setListLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setListLoading(false);
        setListError(error instanceof Error ? error.message : 'Failed to load content history');
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, targetType, targetId, listEpoch]);

  const primaryId = selectedIds[0] ?? null;
  const compareId = selectedIds[1] ?? null;

  // Snapshot only when a version is selected.
  useEffect(() => {
    if (!open || primaryId === null) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setSnapshotLoading(true);
    void getRevision(primaryId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setSnapshot(detail);
        setSnapshotLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSnapshot(null);
        setSnapshotLoading(false);
        toast.error('Failed to load version');
      });
    return () => {
      cancelled = true;
    };
  }, [open, primaryId]);

  // Diff: one selection → against live; two → between those versions (older as base).
  useEffect(() => {
    if (!open || primaryId === null) {
      setDiffs(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);

    let baseId = primaryId;
    let against: string = 'current';
    if (compareId !== null) {
      const primaryMeta = revisions.find((row) => row.id === primaryId);
      const compareMeta = revisions.find((row) => row.id === compareId);
      const primaryTime = Date.parse(primaryMeta?.created_at ?? '');
      const compareTime = Date.parse(compareMeta?.created_at ?? '');
      if (!Number.isNaN(primaryTime) && !Number.isNaN(compareTime) && compareTime < primaryTime) {
        baseId = compareId;
        against = primaryId;
      } else {
        baseId = primaryId;
        against = compareId;
      }
    }

    void diffRevision(baseId, against)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setDiffs(result);
        setDiffLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setDiffs(null);
        setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, primaryId, compareId, revisions]);

  const versionedFieldList = useMemo(
    () => [...versionedFieldsFor(targetType)] as string[],
    [targetType],
  );

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((rowId) => rowId !== id);
      }
      if (current.length >= 2) {
        const first = current[0];
        if (first === undefined) {
          return [id];
        }
        return [first, id];
      }
      return [...current, id];
    });
  };

  const handleRestore = async () => {
    if (confirmRestoreId === null) {
      return;
    }
    setRestoring(true);
    try {
      const entity = await restoreRevision(confirmRestoreId);
      setConfirmRestoreId(null);
      setSelectedIds([]);
      setSnapshot(null);
      setDiffs(null);
      setListEpoch((value) => value + 1);
      if (targetType === 'task') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasksRoot(projectId) });
      } else if (targetType === 'document') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.document(targetId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(projectId) });
      }
      onRestored?.(entity);
      toast.success('Content restored');
    } catch {
      toast.error('Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const showDiff = compareId !== null || (primaryId !== null && diffs !== null && diffs.length > 0);
  const showContent = primaryId !== null && compareId === null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          aria-label="Content history"
          className="flex w-[min(100vw,32rem)] flex-col gap-0 p-0 sm:max-w-[32rem]"
        >
          <div className="border-b px-4 py-3">
            <SheetTitle className="text-[15px] font-semibold">Content history</SheetTitle>
            <SheetDescription className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {RETENTION_COPY}
            </SheetDescription>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {listLoading ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Loading content history…</p>
            ) : null}

            {!listLoading && listError !== null ? (
              <p role="alert" className="px-4 py-6 text-sm text-destructive">
                {listError}
              </p>
            ) : null}

            {!listLoading && listError === null && revisions.length === 0 ? (
              <div
                data-testid="content-history-empty"
                className="px-4 py-8 text-sm text-muted-foreground"
              >
                <p className="font-medium text-foreground">No content history yet</p>
                <p className="mt-2 leading-relaxed">{RETENTION_COPY}</p>
              </div>
            ) : null}

            {!listLoading && listError === null && revisions.length > 0 ? (
              <>
                <ul className="max-h-[40%] shrink-0 overflow-y-auto border-b" aria-label="Versions">
                  {revisions.map((row) => {
                    const selected = selectedIds.includes(row.id);
                    const selectionIndex = selectedIds.indexOf(row.id);
                    return (
                      <li
                        key={row.id}
                        className={cn(
                          'flex items-start gap-2 border-b border-border/60 px-4 py-2.5 text-[13px]',
                          selected ? 'bg-muted' : '',
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-2 text-left transition-colors hover:opacity-90"
                          aria-pressed={selected}
                          onClick={() => {
                            toggleSelection(row.id);
                          }}
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-[10px] font-medium',
                              selected
                                ? 'border-foreground bg-foreground text-background'
                                : 'border-border text-muted-foreground',
                            )}
                            aria-hidden
                          >
                            {selectionIndex >= 0 ? String(selectionIndex + 1) : ''}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-foreground">
                              {formatRevisionAuthor(row.author)}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {relativeTime(row.created_at)}
                              {row.changed_fields.length > 0
                                ? ` · ${row.changed_fields.map(fieldLabel).join(', ')}`
                                : ''}
                            </span>
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="shrink-0"
                          onClick={() => {
                            setConfirmRestoreId(row.id);
                          }}
                        >
                          Restore
                        </Button>
                      </li>
                    );
                  })}
                </ul>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {primaryId === null ? (
                    <p className="text-[13px] text-muted-foreground">
                      Select a version to read it. Select a second to compare them. A single
                      selection diffs against the live content by default.
                    </p>
                  ) : null}

                  {showContent ? (
                    <section aria-label="Version content" className="space-y-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Version content
                      </h3>
                      {snapshotLoading ? (
                        <p className="text-sm text-muted-foreground">Loading version…</p>
                      ) : null}
                      {!snapshotLoading && snapshot !== null
                        ? versionedFieldList.map((field) => (
                            <div key={field}>
                              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                                {fieldLabel(field)}
                              </div>
                              <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-2 font-mono text-[12px] leading-relaxed">
                                {snapshotText(snapshot.snapshot, field) || '—'}
                              </pre>
                            </div>
                          ))
                        : null}
                    </section>
                  ) : null}

                  {primaryId !== null && (showDiff || diffLoading) ? (
                    <section
                      aria-label="Content diff"
                      className={cn('space-y-3', showContent ? 'mt-6 border-t pt-4' : '')}
                    >
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {compareId !== null ? 'Diff between versions' : 'Diff vs live content'}
                      </h3>
                      {diffLoading ? (
                        <p className="text-sm text-muted-foreground">Loading diff…</p>
                      ) : null}
                      {!diffLoading && diffs !== null && diffs.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">No differences.</p>
                      ) : null}
                      {!diffLoading && diffs !== null
                        ? diffs.map((fieldDiff) => (
                            <div key={fieldDiff.field}>
                              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                                {fieldLabel(fieldDiff.field)}
                              </div>
                              <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[12px] leading-relaxed">
                                {fieldDiff.hunks.flatMap((hunk) => hunk.lines).join('\n')}
                              </pre>
                            </div>
                          ))
                        : null}
                    </section>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmRestoreId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmRestoreId(null);
          }
        }}
        title="Restore from content history?"
        description={restoreConfirmDescription(targetType)}
        confirmLabel="Restore"
        busyLabel="Restoring…"
        busy={restoring}
        onConfirm={() => {
          void handleRestore();
        }}
      />
    </>
  );
}

type ContentHistoryButtonProps = {
  projectId: string;
  targetType: RevisionTargetType;
  targetId: string;
  onRestored?: (entity: SerializedTask | SerializedDocument) => void;
  className?: string;
};

/** Affordance that opens the content-history panel. */
export function ContentHistoryButton({
  projectId,
  targetType,
  targetId,
  onRestored,
  className,
}: ContentHistoryButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        aria-label="Content history"
        onClick={() => {
          setOpen(true);
        }}
      >
        <HistoryIcon className="size-3.5" />
        History
      </Button>
      {open ? (
        <ContentHistoryPanel
          projectId={projectId}
          targetType={targetType}
          targetId={targetId}
          open={open}
          onOpenChange={setOpen}
          onRestored={onRestored}
        />
      ) : null}
    </>
  );
}
