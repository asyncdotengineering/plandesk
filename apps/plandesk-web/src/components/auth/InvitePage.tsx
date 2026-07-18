import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, acceptInvitation, fetchInvitation, startGithubSignIn } from '../../lib/api.js';
import { useAuthSession } from '../../lib/auth.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AuthShell, GithubGlyph } from './AuthShell.js';

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1.5 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * The `/invite/:invitationId` claim page — an invited person's first touch.
 *
 * Renders rootless (bypasses the AuthGate) so a signed-out invitee reaches it.
 * Previews the org + role by capability (the link is the authorization), then:
 * signed-out → GitHub, returning here to accept; signed-in → accept → workspace.
 */
export function InvitePage({ invitationId }: { invitationId: string }) {
  const session = useAuthSession();
  const preview = useQuery({
    queryKey: ['invitation', invitationId],
    queryFn: () => fetchInvitation(invitationId),
    retry: false,
  });

  const [starting, setStarting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const signedIn = session.data !== null && session.data !== undefined;

  async function onGithub() {
    setActionError(null);
    setStarting(true);
    try {
      const { url } = await startGithubSignIn(`/invite/${invitationId}`);
      window.location.assign(url);
    } catch (err) {
      setStarting(false);
      setActionError(err instanceof Error ? err.message : 'Could not start GitHub sign-in');
    }
  }

  async function onAccept() {
    setActionError(null);
    setAccepting(true);
    try {
      await acceptInvitation(invitationId);
      setAccepted(true);
      // Full reload so the new membership + active org resolve on the way in.
      window.location.assign('/');
    } catch (err) {
      setAccepting(false);
      if (err instanceof ApiError) {
        if (err.status === 410) {
          setActionError('This invitation has expired or was already used.');
          return;
        }
        if (err.status === 403) {
          const invited = preview.data?.email ?? 'a different address';
          setActionError(
            `This invite was sent to ${invited}. Sign in with that account to accept.`,
          );
          return;
        }
        if (err.status === 401) {
          setActionError('Please sign in to accept this invitation.');
          return;
        }
      }
      setActionError(err instanceof Error ? err.message : 'Could not accept the invitation.');
    }
  }

  let content: React.ReactNode;
  if (preview.isLoading || session.isLoading) {
    content = <p className="text-sm text-muted-foreground">Loading invitation…</p>;
  } else if (preview.error !== null) {
    content = (
      <Notice
        title="Invitation not found"
        body="This invitation link is invalid or was withdrawn. Ask whoever invited you for a new link."
      />
    );
  } else if (preview.data !== undefined && preview.data.status !== 'pending') {
    content = (
      <Notice
        title="Invitation already used"
        body="This invitation has already been accepted or was canceled. Ask an admin to send a new one."
      />
    );
  } else if (preview.data !== undefined) {
    const org = preview.data.organizationName || 'a team';
    const workspace =
      preview.data.workspaceName !== undefined && preview.data.workspaceName.length > 0
        ? preview.data.workspaceName
        : null;
    content = (
      <div className="space-y-5 text-center">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">You&rsquo;re invited</h1>
          <p className="text-sm text-muted-foreground">
            {workspace !== null ? (
              <>
                Join <span className="font-medium text-foreground">{workspace}</span> on Plan Desk
                as{' '}
                <span className="font-medium capitalize text-foreground">{preview.data.role}</span>.
              </>
            ) : (
              <>
                Join <span className="font-medium text-foreground">{org}</span> on Plan Desk as{' '}
                <span className="font-medium capitalize text-foreground">{preview.data.role}</span>.
              </>
            )}
          </p>
        </div>

        {accepted ? (
          <p className="text-sm text-muted-foreground">
            You&rsquo;re in — taking you to the workspace…
          </p>
        ) : signedIn ? (
          <Button
            type="button"
            className="w-full"
            disabled={accepting}
            onClick={() => void onAccept()}
          >
            {accepting ? 'Joining…' : 'Accept invitation'}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full gap-2"
              disabled={starting}
              onClick={() => void onGithub()}
            >
              <GithubGlyph />
              {starting ? 'Redirecting…' : 'Continue with GitHub'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Sign in with GitHub using {preview.data.email} to accept.
            </p>
          </div>
        )}

        {actionError !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <AuthShell>
      <Card className="w-full p-6">{content}</Card>
    </AuthShell>
  );
}
