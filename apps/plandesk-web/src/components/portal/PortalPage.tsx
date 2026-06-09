import { useQueryClient } from '@tanstack/react-query';
import { capabilitiesFromShare } from '../../lib/capabilities.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import type { ClientView, PortalSubmission } from '../../lib/portal.js';
import { PortalBoard } from './PortalBoard.js';
import { SubmissionsList, submissionsQueryKey } from './SubmissionsList.js';
import { SubmitIssue } from './SubmitIssue.js';

type PortalPageProps = {
  view: ClientView;
  shareToken: string;
  sessionToken: string;
  onUnauthorized: () => void;
};

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function PortalPage({ view, shareToken, sessionToken, onUnauthorized }: PortalPageProps) {
  const queryClient = useQueryClient();
  const caps = capabilitiesFromShare(view.share.permissions);
  const canSubmit = caps.includes('submit');
  const taskLabelById = new Map(view.tasks.map((task) => [task.id, task.label]));
  const progressEntries = Object.entries(view.progress);

  function handleSubmitted(submission: PortalSubmission) {
    const key = submissionsQueryKey(shareToken, sessionToken);
    queryClient.setQueryData<PortalSubmission[]>(key, (existing) => [
      submission,
      ...(existing ?? []),
    ]);
    void queryClient.invalidateQueries({ queryKey: key });
  }

  return (
    <article data-portal-view>
      <header style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            flexWrap: 'wrap',
            marginBottom: '0.5rem',
          }}
        >
          <h1 style={{ margin: 0, flex: '1 1 auto' }}>{view.project.name}</h1>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#1e40af',
              background: '#dbeafe',
              borderRadius: 999,
              padding: '0.25rem 0.75rem',
            }}
          >
            shared, read-only
          </span>
        </div>
        <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
          Shared with {view.share.audience_name}
        </p>
        {view.project.description ? (
          <p style={{ margin: '0.75rem 0 0', color: '#4b5563' }}>{view.project.description}</p>
        ) : null}
      </header>

      {progressEntries.length > 0 ? (
        <section style={{ marginBottom: '1.5rem' }} aria-label="Progress">
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Progress</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {progressEntries.map(([status, count]) => (
              <span
                key={status}
                style={{
                  fontSize: '0.8125rem',
                  padding: '0.25rem 0.625rem',
                  borderRadius: 999,
                  background: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                }}
              >
                {formatStatusLabel(status)}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: '1.5rem' }} aria-label="Board">
        <h2 style={{ fontSize: '1rem' }}>Board</h2>
        <PortalBoard tasks={view.tasks} />
      </section>

      {view.edges.length > 0 ? (
        <section style={{ marginBottom: '1.5rem' }} aria-label="Dependencies">
          <h2 style={{ fontSize: '1rem' }}>Dependencies</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {view.edges.map((edge) => {
              const fromLabel = taskLabelById.get(edge.from) ?? edge.from;
              const toLabel = taskLabelById.get(edge.to) ?? edge.to;
              const labelSuffix = edge.label !== null ? ` (${edge.label})` : '';
              return (
                <li
                  key={edge.id}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                    background: '#fafafa',
                    fontSize: '0.875rem',
                  }}
                >
                  {fromLabel} → {toLabel}
                  {labelSuffix}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {view.documents.length > 0 ? (
        <section style={{ marginBottom: '1.5rem' }} aria-label="Documents">
          <h2 style={{ fontSize: '1rem' }}>Documents</h2>
          <div style={{ display: 'grid', gap: '1.25rem' }}>
            {view.documents.map((doc) => (
              <div key={doc.id}>
                <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>{doc.title}</h3>
                {doc.body_html !== null && doc.body_html !== '' ? (
                  <div
                    className="portal-document-content"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.body_html) }}
                    style={{
                      lineHeight: 1.6,
                      padding: '1rem',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      background: '#fff',
                    }}
                  />
                ) : (
                  <p style={{ color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>No content</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canSubmit ? (
        <>
          <SubmitIssue
            shareToken={shareToken}
            sessionToken={sessionToken}
            onSubmitted={handleSubmitted}
            onUnauthorized={onUnauthorized}
          />
          <SubmissionsList
            shareToken={shareToken}
            sessionToken={sessionToken}
            onUnauthorized={onUnauthorized}
          />
        </>
      ) : null}
    </article>
  );
}
