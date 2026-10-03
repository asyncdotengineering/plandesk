/** Relative display with absolute value in `title` — settled product format for entity timestamps. */
export function formatAbsoluteTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}

export function formatRelativeTimestamp(iso: string, nowMs = Date.now()): string {
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

export function Timestamp({ iso, label }: { iso: string; label: string }) {
  const relative = formatRelativeTimestamp(iso);
  const absolute = formatAbsoluteTimestamp(iso);
  return (
    <time dateTime={iso} title={absolute} className="text-[var(--text-2)]">
      {label} {relative}
    </time>
  );
}

export function VerificationStatus({
  verifiedAt,
  verifiedRef,
}: {
  verifiedAt?: string | null;
  verifiedRef?: string | null;
}) {
  if (verifiedAt === null || verifiedAt === undefined) {
    return (
      <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
        Never verified
      </span>
    );
  }
  const relative = formatRelativeTimestamp(verifiedAt);
  const refSuffix =
    verifiedRef !== null && verifiedRef !== undefined && verifiedRef.trim() !== ''
      ? ` · ${verifiedRef}`
      : '';
  return (
    <span className="text-[11px] text-muted-foreground">
      Verified {relative}
      {refSuffix}
    </span>
  );
}

export function EntityTimestamps({
  createdAt,
  updatedAt,
}: {
  createdAt: string;
  updatedAt: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Timestamp iso={createdAt} label="Created" />
      <Timestamp iso={updatedAt} label="Updated" />
    </div>
  );
}
