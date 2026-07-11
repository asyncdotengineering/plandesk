import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  PortalUnauthorizedError,
  listMySubmissions,
  type PortalSubmission,
} from '../../lib/portal.js';

type SubmissionsListProps = {
  shareToken: string;
  sessionToken: string;
  onUnauthorized: () => void;
};

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function statusBadgeStyle(status: string): { backgroundColor: string; color: string } {
  switch (status) {
    case 'accepted':
      return { backgroundColor: 'var(--s-done-bg)', color: 'var(--s-done-fg)' };
    case 'rejected':
      return { backgroundColor: 'var(--destructive)', color: 'var(--destructive-foreground)' };
    case 'pending':
    default:
      return { backgroundColor: 'var(--s-prog-bg)', color: 'var(--s-prog-fg)' };
  }
}

function StatusBadge({ status }: { status: string }) {
  const style = statusBadgeStyle(status);
  return (
    <Badge
      variant="secondary"
      className="border-transparent text-xs font-semibold capitalize"
      style={style}
    >
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

export function submissionsQueryKey(shareToken: string, sessionToken: string): string[] {
  return ['portal', shareToken, sessionToken, 'submissions'];
}

export function SubmissionsList({
  shareToken,
  sessionToken,
  onUnauthorized,
}: SubmissionsListProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: submissionsQueryKey(shareToken, sessionToken),
    queryFn: () => listMySubmissions(shareToken, sessionToken),
    retry: false,
  });

  const unauthorized = error instanceof PortalUnauthorizedError;

  useEffect(() => {
    if (unauthorized) {
      onUnauthorized();
    }
  }, [unauthorized, onUnauthorized]);

  if (unauthorized) {
    return null;
  }

  if (error) {
    return (
      <section aria-label="Your reported issues" className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Your reported issues</h2>
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load your submissions.'}
        </p>
      </section>
    );
  }

  const submissions: PortalSubmission[] = data ?? [];

  return (
    <section aria-label="Your reported issues" className="mb-6">
      <h2 className="mb-3 text-sm font-semibold">Your reported issues</h2>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">You haven&apos;t reported anything yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Card className="gap-0 p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <strong className="text-sm">{submission.title}</strong>
                  <StatusBadge status={submission.status} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {submission.severity !== null ? <span>Severity: {submission.severity}</span> : null}
                  <span>{formatCreatedAt(submission.created_at)}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}