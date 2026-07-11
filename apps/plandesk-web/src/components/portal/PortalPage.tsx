import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { capabilitiesFromShare } from '../../lib/capabilities.js';
import { bodyToHtml } from '../../lib/markdown.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import '../docs/document-editor.css';
import type { ClientView, PortalSubmission } from '../../lib/portal.js';
import { statusTokenVars } from '../board/StatusChip.js';
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

function progressChipStyle(status: string): { backgroundColor: string; color: string } {
  if (status in statusTokenVars) {
    const vars = statusTokenVars[status as keyof typeof statusTokenVars];
    return { backgroundColor: vars.bg, color: vars.fg };
  }
  return { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' };
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
    <article data-portal-view className="mx-auto max-w-5xl px-5 py-6 pb-16">
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-start gap-3">
          <h1 className="flex-1 text-2xl font-bold tracking-tight">{view.project.name}</h1>
          <Badge variant="secondary" className="shrink-0 text-[11px] font-semibold">
            shared, read-only
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">Shared with {view.share.audience_name}</p>
        {view.project.description ? (
          <p className="mt-3 text-sm leading-relaxed text-foreground/80">{view.project.description}</p>
        ) : null}
      </header>

      {progressEntries.length > 0 ? (
        <section className="mb-6" aria-label="Progress">
          <h2 className="mb-3 text-sm font-semibold">Progress</h2>
          <div className="flex flex-wrap gap-2">
            {progressEntries.map(([status, count]) => {
              const chipStyle = progressChipStyle(status);
              return (
                <span
                  key={status}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={chipStyle}
                >
                  {formatStatusLabel(status)}: <strong>{count}</strong>
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mb-6" aria-label="Board">
        <h2 className="mb-3 text-sm font-semibold">Board</h2>
        <PortalBoard tasks={view.tasks} />
      </section>

      {view.edges.length > 0 ? (
        <section className="mb-6" aria-label="Dependencies">
          <h2 className="mb-3 text-sm font-semibold">Dependencies</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {view.edges.map((edge) => {
              const fromLabel = taskLabelById.get(edge.from) ?? edge.from;
              const toLabel = taskLabelById.get(edge.to) ?? edge.to;
              const labelSuffix = edge.label !== null ? ` (${edge.label})` : '';
              return (
                <li key={edge.id}>
                  <Card className="px-3 py-2 text-sm shadow-sm">
                    {fromLabel} → {toLabel}
                    {labelSuffix}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {view.documents.length > 0 ? (
        <section className="mb-6" aria-label="Documents">
          <h2 className="mb-3 text-sm font-semibold">Documents</h2>
          <div className="grid gap-5">
            {view.documents.map((doc) => (
              <div key={doc.id}>
                <h3 className="mb-2 text-sm font-semibold">{doc.title}</h3>
                {doc.body_html !== null && doc.body_html !== '' ? (
                  <div
                    className="portal-document-content rounded-lg border border-border bg-card p-4 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyToHtml(doc.body_html)) }}
                  />
                ) : (
                  <p className="m-0 text-sm italic text-muted-foreground">No content</p>
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