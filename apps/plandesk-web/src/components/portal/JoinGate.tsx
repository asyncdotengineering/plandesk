import { useEffect, useState, type SubmitEvent } from 'react';
import {
  PortalEmailNotInvitedError,
  PortalJoinError,
  PortalUnauthorizedError,
  fetchShareMeta,
  joinShare,
  type ShareMeta,
} from '../../lib/portal.js';

type JoinGateProps = {
  shareToken: string;
  onJoined: (sessionToken: string) => void;
};

export function JoinGate({ shareToken, onJoined }: JoinGateProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      setMetaLoading(true);
      setShareError(null);
      try {
        const result = await fetchShareMeta(shareToken);
        if (!cancelled) {
          setMeta(result);
        }
      } catch (error) {
        if (!cancelled) {
          if (error instanceof PortalUnauthorizedError) {
            setShareError(error.message);
          } else {
            setShareError(
              error instanceof Error ? error.message : 'Something went wrong. Please try again.',
            );
          }
        }
      } finally {
        if (!cancelled) {
          setMetaLoading(false);
        }
      }
    }

    void loadMeta();

    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const emailRequired = meta?.mode === 'invite';
  const canSubmit =
    trimmedName.length > 0 &&
    (!emailRequired || trimmedEmail.length > 0) &&
    !pending &&
    !metaLoading;

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
        email: trimmedEmail === '' ? undefined : trimmedEmail,
      });
      onJoined(result.session_token);
    } catch (error) {
      if (error instanceof PortalUnauthorizedError) {
        setShareError(error.message);
      } else if (error instanceof PortalEmailNotInvitedError) {
        setFieldError(error.message);
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
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>
          {meta?.audience_name ?? 'Join shared project'}
        </h1>
        <p style={{ margin: '0.5rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
          {metaLoading
            ? 'Loading share details…'
            : emailRequired
              ? 'Enter your name and invited email to view this read-only plan.'
              : 'Enter your name to view this read-only plan.'}
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
            disabled={metaLoading || shareError !== null}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: '0.9375rem',
            }}
          />
          {fieldError !== null && !emailRequired ? (
            <span role="alert" style={{ color: '#b91c1c', fontSize: '0.8125rem' }}>
              {fieldError}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: '0.375rem', fontSize: '0.875rem' }}>
          <span>
            {emailRequired ? 'Invited email' : 'Email'}{' '}
            {!emailRequired ? <span style={{ color: '#9ca3af' }}>(optional)</span> : null}
          </span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            autoComplete="email"
            required={emailRequired}
            disabled={metaLoading || shareError !== null}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: '0.9375rem',
            }}
          />
          {emailRequired ? (
            <span style={{ color: '#6b7280', fontSize: '0.8125rem' }}>
              Use the email your invite was sent to.
            </span>
          ) : null}
          {fieldError !== null && emailRequired ? (
            <span role="alert" style={{ color: '#b91c1c', fontSize: '0.8125rem' }}>
              {fieldError}
            </span>
          ) : null}
        </label>

        <button
          type="submit"
          disabled={!canSubmit || shareError !== null}
          style={{
            padding: '0.625rem 1rem',
            borderRadius: 6,
            border: 'none',
            background: canSubmit && shareError === null ? '#1e40af' : '#9ca3af',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.9375rem',
            cursor: canSubmit && shareError === null ? 'pointer' : 'not-allowed',
          }}
        >
          {pending ? 'Joining…' : 'Join'}
        </button>
      </form>
    </section>
  );
}
