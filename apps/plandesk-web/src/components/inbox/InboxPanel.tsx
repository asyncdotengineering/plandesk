import { useState } from 'react';
import type { SerializedSubmission } from '../../lib/api.js';
import { usePatchTask, useSubmissions, useTasks, useTriageSubmission } from '../../lib/queries.js';

type InboxPanelProps = {
  projectId: string;
};

const EXCERPT_LENGTH = 140;

function excerpt(text: string | null): string | null {
  if (text === null || text.trim() === '') {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_LENGTH ? `${trimmed.slice(0, EXCERPT_LENGTH)}…` : trimmed;
}

// The Curator's triage skill (.agents/curator/triage.md) tags every proposal it
// writes with a one-line `Provenance:` marker in the task description — that
// literal string is the only signal we have client-side to recognize a
// Curator-authored `scope` task versus any other one.
function provenanceLine(description: string | null): string | null {
  if (description === null) {
    return null;
  }
  const line = description.split('\n').find((candidate) => candidate.includes('Provenance:'));
  return line?.trim() ?? null;
}

const buttonBase = {
  padding: '0.375rem 0.75rem',
  borderRadius: 6,
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
} as const;

const acceptButtonStyle = {
  ...buttonBase,
  border: 'none',
  background: '#1e40af',
  color: '#fff',
};

const rejectButtonStyle = {
  ...buttonBase,
  border: '1px solid #fca5a5',
  background: '#fef2f2',
  color: '#b91c1c',
};

const neutralButtonStyle = {
  ...buttonBase,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
};

function SubmissionRow({
  submission,
  projectId,
}: {
  submission: SerializedSubmission;
  projectId: string;
}) {
  const triage = useTriageSubmission(projectId);
  const [mergeTaskId, setMergeTaskId] = useState('');

  return (
    <li
      style={{
        padding: '0.75rem',
        borderRadius: 6,
        border: '1px solid #e5e7eb',
        background: '#fff',
        display: 'grid',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <strong style={{ fontSize: '0.9375rem' }}>{submission.title}</strong>
        <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
          {submission.participant_name}
        </span>
      </div>
      {excerpt(submission.body) !== null ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#4b5563' }}>
          {excerpt(submission.body)}
        </p>
      ) : null}

      {triage.isError ? (
        <p role="alert" style={{ margin: 0, fontSize: '0.8125rem', color: '#b91c1c' }}>
          Something went wrong. Please try again.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          disabled={triage.isPending}
          onClick={() => {
            triage.mutate({ id: submission.id, input: { action: 'accept' } });
          }}
          style={acceptButtonStyle}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={triage.isPending}
          onClick={() => {
            triage.mutate({ id: submission.id, input: { action: 'reject' } });
          }}
          style={rejectButtonStyle}
        >
          Reject
        </button>
        <input
          type="text"
          value={mergeTaskId}
          onChange={(event) => {
            setMergeTaskId(event.target.value);
          }}
          placeholder="Existing task id"
          disabled={triage.isPending}
          style={{
            padding: '0.375rem 0.5rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            fontSize: '0.8125rem',
            width: '11rem',
          }}
        />
        <button
          type="button"
          disabled={triage.isPending || mergeTaskId.trim() === ''}
          onClick={() => {
            triage.mutate({
              id: submission.id,
              input: { action: 'accept', link_task_id: mergeTaskId.trim() },
            });
          }}
          style={neutralButtonStyle}
        >
          Merge into
        </button>
        <span style={{ fontSize: '0.75rem', color: '#9ca3af', width: '100%' }}>
          Linking isn&apos;t wired up yet — this still files a new scope task rather than
          attaching to the id above.
        </span>
      </div>
    </li>
  );
}

function PendingSubmissions({ projectId }: { projectId: string }) {
  const { data: submissions, isLoading, error } = useSubmissions(projectId, 'pending');

  return (
    <section aria-label="Pending submissions" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Pending submissions</h2>
      {isLoading ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>Loading…</p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', margin: 0 }}>
          Failed to load submissions.
        </p>
      ) : null}
      {!isLoading && !error && (submissions === undefined || submissions.length === 0) ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
          No pending submissions — this project has no share configured, or nothing new has come
          in.
        </p>
      ) : null}
      {submissions !== undefined && submissions.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {submissions.map((submission) => (
            <SubmissionRow key={submission.id} submission={submission} projectId={projectId} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function BacklogTasks({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading, error } = useTasks(projectId, { status: 'backlog' });
  const patchTask = usePatchTask();

  return (
    <section aria-label="Un-triaged backlog" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Un-triaged backlog</h2>
      {isLoading ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>Loading…</p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', margin: 0 }}>
          Failed to load backlog tasks.
        </p>
      ) : null}
      {!isLoading && !error && (tasks === undefined || tasks.length === 0) ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
          Nothing in the backlog right now.
        </p>
      ) : null}
      {tasks !== undefined && tasks.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {tasks.map((task) => (
            <li
              key={task.id}
              style={{
                padding: '0.75rem',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                background: '#fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <div>
                <strong style={{ fontSize: '0.9375rem' }}>{task.label}</strong>
                {excerpt(task.description) !== null ? (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#4b5563' }}>
                    {excerpt(task.description)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={patchTask.isPending}
                onClick={() => {
                  patchTask.mutate({ id: task.id, input: { status: 'scope' } });
                }}
                style={neutralButtonStyle}
              >
                Release to scope
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CuratorProposals({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading, error } = useTasks(projectId, { status: 'scope' });
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  const proposals = (tasks ?? []).filter(
    (task) => provenanceLine(task.description) !== null,
  );

  return (
    <section aria-label="Curator proposals awaiting approval" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Curator proposals awaiting approval</h2>
      {isLoading ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>Loading…</p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', margin: 0 }}>
          Failed to load proposals.
        </p>
      ) : null}
      {!isLoading && !error && proposals.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
          No Curator proposals waiting right now.
        </p>
      ) : null}
      {proposals.length > 0 ? (
        <>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
            These are `scope` tasks the Curator proposed. Releasing a task from{' '}
            <code>scope</code> to <code>todo</code> on the Board is the actual approval — nothing
            here does that for you.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {proposals.map((task) => (
              <li
                key={task.id}
                style={{
                  padding: '0.75rem',
                  borderRadius: 6,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.9375rem' }}>{task.label}</strong>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#4b5563' }}>
                    {provenanceLine(task.description)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={acknowledged.has(task.id)}
                  onClick={() => {
                    setAcknowledged((prev) => new Set(prev).add(task.id));
                  }}
                  style={neutralButtonStyle}
                >
                  {acknowledged.has(task.id) ? 'Acknowledged' : 'Looks good'}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function InboxPanel({ projectId }: InboxPanelProps) {
  return (
    <div>
      <PendingSubmissions projectId={projectId} />
      <BacklogTasks projectId={projectId} />
      <CuratorProposals projectId={projectId} />
    </div>
  );
}
