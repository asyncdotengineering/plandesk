import { useState, type SubmitEvent } from 'react';
import {
  PortalRateLimitedError,
  PortalSubmitFieldError,
  PortalSubmitForbiddenError,
  PortalUnauthorizedError,
  submitIssue,
  type PortalSubmission,
} from '../../lib/portal.js';

type SubmitIssueProps = {
  shareToken: string;
  sessionToken: string;
  onSubmitted: (submission: PortalSubmission) => void;
  onUnauthorized: () => void;
};

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

export function SubmitIssue({
  shareToken,
  sessionToken,
  onSubmitted,
  onUnauthorized,
}: SubmitIssueProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('');
  const [taskRef, setTaskRef] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formHidden, setFormHidden] = useState(false);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !pending && !formHidden;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setPending(true);
    setFieldError(null);
    setRateLimitError(null);
    setSuccessMessage(null);

    try {
      const submission = await submitIssue(shareToken, sessionToken, {
        title: trimmedTitle,
        body: body.trim() === '' ? undefined : body.trim(),
        severity: severity === '' ? undefined : severity,
        task_ref: taskRef.trim() === '' ? undefined : taskRef.trim(),
      });

      setTitle('');
      setBody('');
      setSeverity('');
      setTaskRef('');
      setExpanded(false);
      setSuccessMessage('Reported ✓');
      onSubmitted(submission);
    } catch (error) {
      if (error instanceof PortalUnauthorizedError) {
        onUnauthorized();
        return;
      }
      if (error instanceof PortalSubmitForbiddenError) {
        setFormHidden(true);
        return;
      }
      if (error instanceof PortalRateLimitedError) {
        setRateLimitError(error.message);
        return;
      }
      if (error instanceof PortalSubmitFieldError) {
        setFieldError(error.message);
        return;
      }
      setFieldError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  if (formHidden) {
    return null;
  }

  return (
    <section
      aria-label="Report an issue"
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
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Report an issue</h2>
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
            Report an issue
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

      {rateLimitError !== null ? (
        <p role="alert" style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontSize: '0.875rem' }}>
          {rateLimitError}
        </p>
      ) : null}

      {expanded ? (
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
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
              disabled={pending}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: '0.9375rem',
              }}
            />
            {fieldError !== null ? (
              <span role="alert" style={{ color: '#b91c1c', fontSize: '0.8125rem' }}>
                {fieldError}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
            <span>Description</span>
            <textarea
              name="body"
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              rows={4}
              disabled={pending}
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
              disabled={pending}
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

          <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
            <span>
              Related task <span style={{ color: '#9ca3af' }}>(optional)</span>
            </span>
            <input
              type="text"
              name="task_ref"
              value={taskRef}
              onChange={(event) => {
                setTaskRef(event.target.value);
              }}
              disabled={pending}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: '0.9375rem',
              }}
            />
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
              {pending ? 'Submitting…' : 'Submit'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setExpanded(false);
                setFieldError(null);
                setRateLimitError(null);
              }}
              style={{
                padding: '0.625rem 1rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                fontWeight: 600,
                fontSize: '0.9375rem',
                cursor: pending ? 'not-allowed' : 'pointer',
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
