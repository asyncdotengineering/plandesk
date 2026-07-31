type BlockedIndicatorProps = {
  blocked?: boolean;
  waitingOn?: string[] | undefined;
};

/** Blocked badge — driven only by the API `blocked` field, never re-derived locally. */
export function BlockedIndicator({ blocked, waitingOn }: BlockedIndicatorProps) {
  if (blocked !== true) {
    return null;
  }

  return (
    <span
      data-blocked
      className="text-[10.5px] font-medium uppercase tracking-wide text-destructive"
      title={
        waitingOn !== undefined && waitingOn.length > 0
          ? `Waiting on ${String(waitingOn.length)} prerequisite${waitingOn.length === 1 ? '' : 's'}`
          : 'Waiting on unfinished prerequisites'
      }
    >
      Blocked
    </span>
  );
}
