import { useState, type SubmitEvent } from 'react';
import { PortalJoinError, PortalUnauthorizedError, joinShare } from '../../lib/portal.js';

type JoinGateProps = {
  shareToken: string;
  onJoined: (sessionToken: string) => void;
};

export function JoinGate({ shareToken, onJoined }: JoinGateProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !pending;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setPending(true);
    setShareError(null);
    setFieldError(null);

    try {
      const result = await joinShare(shareToken, {
        name: trimmedName,
        email: email.trim() === '' ? undefined : email.trim(),
      });
      onJoined(result.session_token);
    } catch (error) {
      if (error instanceof PortalUnauthorizedError) {
        setShareError(error.message);
      } else if (error instanceof PortalJoinError) {
        setFieldError(error.message);
      } else {
        setShareError(
          error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label="Join shared project"
      style={{
        maxWidth: 420,
        margin: '2rem auto',
        padding: '1.5rem',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
      }}
    >
      <header style={{ marginBottom: '1.25rem' }}>
        <p
          style={{
            margin: '0 0 0.5rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#6b7280',
          }}
        >
          Plan Desk
        </p>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Join shared project</h1>
        <p style={{ margin: '0.5rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
          Enter your name to view this read-only plan.
        </p>
      </header>

      {shareError !== null ? (
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', marginTop: 0 }}>
          {shareError}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        style={{ display: 'grid', gap: '1rem' }}
      >
        <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
          <span>Name</span>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            autoComplete="name"
            required
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
          <span>
            Email <span style={{ color: '#9ca3af' }}>(optional)</span>
          </span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            autoComplete="email"
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: '0.9375rem',
            }}
          />
        </label>

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
          {pending ? 'Joining…' : 'Join'}
        </button>
      </form>
    </section>
  );
}
