import { useEffect, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <section aria-label="Join shared project" className="mx-auto max-w-md px-5 py-8">
      <Card className="shadow-sm">
        <CardHeader>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plan Desk
          </p>
          <h1 className="text-xl font-semibold leading-none">
            {meta?.audience_name ?? 'Join shared project'}
          </h1>
          <CardDescription>
            {metaLoading
              ? 'Loading share details…'
              : emailRequired
                ? 'Enter your name and invited email to view this read-only plan.'
                : 'Enter your name to view this read-only plan.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shareError !== null ? (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {shareError}
            </p>
          ) : null}
          {shareError !== null && shareError.includes('invalid, expired, or has been revoked') ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Ask whoever shared this link to send you a new one.
            </p>
          ) : null}

          <form
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
            className="grid gap-4"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="portal-name">Name</Label>
              <Input
                id="portal-name"
                type="text"
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                autoComplete="name"
                required
                disabled={metaLoading || shareError !== null}
              />
              {fieldError !== null && !emailRequired ? (
                <span role="alert" className="text-xs text-destructive">
                  {fieldError}
                </span>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="portal-email">
                {emailRequired ? 'Invited email' : 'Email'}{' '}
                {!emailRequired ? (
                  <span className="font-normal text-muted-foreground">(optional)</span>
                ) : null}
              </Label>
              <Input
                id="portal-email"
                type="email"
                name="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                autoComplete="email"
                required={emailRequired}
                disabled={metaLoading || shareError !== null}
              />
              {emailRequired ? (
                <span className="text-xs text-muted-foreground">
                  Use the email your invite was sent to.
                </span>
              ) : null}
              {fieldError !== null && emailRequired ? (
                <span role="alert" className="text-xs text-destructive">
                  {fieldError}
                </span>
              ) : null}
            </div>

            <Button type="submit" disabled={!canSubmit || shareError !== null}>
              {pending ? 'Joining…' : 'Join'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}