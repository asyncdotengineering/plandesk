import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
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

function statusBadgeStyle(status: string): { background: string; color: string; border: string } {
  switch (status) {
    case 'accepted':
      return { background: '#dcfce7', color: '#166534', border: '#bbf7d0' };
    case 'rejected':
      return { background: '#fee2e2', color: '#991b1b', border: '#fecaca' };
    case 'pending':
    default:
      return { background: '#fef3c7', color: '#92400e', border: '#fde68a' };
  }
}

function StatusBadge({ status }: { status: string }) {
  const style = statusBadgeStyle(status);
  return (
    <span
      style={{
        fontSize: '0.75rem',
        fontWeight: 600,
        padding: '0.125rem 0.5rem',
        borderRadius: 999,
        background: style.background,
        color: style.color,
        border: `1px solid ${style.border}`,
        textTransform: 'capitalize',
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
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
      <section aria-label="Your reported issues" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Your reported issues</h2>
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem' }}>
          {error instanceof Error ? error.message : 'Failed to load your submissions.'}
        </p>
      </section>
    );
  }

  const submissions: PortalSubmission[] = data ?? [];

  return (
    <section aria-label="Your reported issues" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Your reported issues</h2>

      {isLoading ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>Loading…</p>
      ) : submissions.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
          You haven&apos;t reported anything yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {submissions.map((submission) => (
            <li
              key={submission.id}
              style={{
                padding: '0.75rem',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                background: '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <strong style={{ fontSize: '0.9375rem' }}>{submission.title}</strong>
                <StatusBadge status={submission.status} />
              </div>
              <div
                style={{
                  marginTop: '0.375rem',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  fontSize: '0.8125rem',
                  color: '#6b7280',
                }}
              >
                {submission.severity !== null ? <span>Severity: {submission.severity}</span> : null}
                <span>{formatCreatedAt(submission.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
