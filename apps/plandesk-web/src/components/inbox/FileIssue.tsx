import { useState, type SubmitEvent } from 'react';
import { useCreateTask } from '../../lib/queries.js';

type FileIssueProps = {
  projectId: string;
};

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

function buildDescription(body: string, severity: string): string | undefined {
  const trimmedBody = body.trim();
  const lines = [trimmedBody];
  if (severity !== '') {
    lines.push(`Severity: ${severity}`);
  }
  const description = lines.filter((line) => line !== '').join('\n\n');
  return description === '' ? undefined : description;
}

export function FileIssue({ projectId }: FileIssueProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const createTask = useCreateTask(projectId);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !createTask.isPending;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSuccessMessage(null);
    createTask.mutate(
      {
        label: trimmedTitle,
        description: buildDescription(body, severity) ?? null,
        status: 'backlog',
      },
      {
        onSuccess: () => {
          setTitle('');
          setBody('');
          setSeverity('');
          setExpanded(false);
          setSuccessMessage('Filed ✓');
        },
      },
    );
  }

  return (
    <section
      aria-label="File an issue"
      style={{
        marginBottom: '1.5rem',
        padding: '1rem',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        background: '#fafafa',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: '1rem', margin: 0 }}>File an issue</h2>
        {!expanded ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
            }}
            style={{
              padding: '0.5rem 0.875rem',
              borderRadius: 6,
              border: 'none',
              background: '#1e40af',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            File an issue
          </button>
        ) : null}
      </div>

      {successMessage !== null ? (
        <p
          role="status"
          style={{ margin: '0.75rem 0 0', color: '#15803d', fontSize: '0.875rem', fontWeight: 600 }}
        >
          {successMessage}
        </p>
      ) : null}

      {createTask.isError ? (
        <p role="alert" style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontSize: '0.875rem' }}>
          Something went wrong. Please try again.
        </p>
      ) : null}

      {expanded ? (
        <form
          onSubmit={handleSubmit}
          style={{ display: 'grid', gap: '0.875rem', marginTop: '1rem' }}
        >
          <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
            <span>Title</span>
            <input
              type="text"
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              required
              disabled={createTask.isPending}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: '0.9375rem',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
            <span>
              Description <span style={{ color: '#9ca3af' }}>(optional)</span>
            </span>
            <textarea
              name="body"
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              rows={4}
              disabled={createTask.isPending}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: '0.9375rem',
                resize: 'vertical',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
            <span>
              Severity <span style={{ color: '#9ca3af' }}>(optional)</span>
            </span>
            <select
              name="severity"
              value={severity}
              onChange={(event) => {
                setSeverity(event.target.value);
              }}
              disabled={createTask.isPending}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: '0.9375rem',
                background: '#fff',
              }}
            >
              <option value="">—</option>
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '0.625rem 1rem',
                borderRadius: 6,
                border: 'none',
                background: canSubmit ? '#1e40af' : '#9ca3af',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.9375rem',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {createTask.isPending ? 'Filing…' : 'File issue'}
            </button>
            <button
              type="button"
              disabled={createTask.isPending}
              onClick={() => {
                setExpanded(false);
              }}
              style={{
                padding: '0.625rem 1rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                fontWeight: 600,
                fontSize: '0.9375rem',
                cursor: createTask.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
