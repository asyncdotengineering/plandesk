import { useState } from 'react';
import { startGithubSignIn } from '../../lib/api.js';
import { useAuthMethods } from '../../lib/auth.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AuthShell, GithubGlyph } from './AuthShell.js';

/**
 * Shown whenever the API says nobody is signed in.
 *
 * GitHub is a convenience, never a requirement: an instance with no GitHub app
 * configured shows the token path instead (REQ-20). GitHub uses better-auth
 * social login (BA4c) so the browser ends up with a better-auth session cookie.
 */
export function SignInPage() {
  const { data: methods, isLoading, error: methodsError, refetch } = useAuthMethods();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function onGithubSignIn() {
    setError(null);
    setStarting(true);
    try {
      const { url } = await startGithubSignIn('/');
      window.location.assign(url);
    } catch (err) {
      setStarting(false);
      setError(err instanceof Error ? err.message : 'Could not start GitHub sign-in');
    }
  }

  return (
    <AuthShell>
      <Card className="w-full space-y-5 p-6 text-center">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Welcome to Plan Desk</h1>
          <p className="text-sm text-muted-foreground">
            The shared graph for planning and building — for your team and your coding agents.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Checking sign-in options…</p>
        ) : null}

        {methodsError !== null ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t load sign-in options.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {methods?.githubEnabled === true ? (
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full gap-2"
              disabled={starting}
              onClick={() => {
                void onGithubSignIn();
              }}
            >
              <GithubGlyph />
              {starting ? 'Redirecting…' : 'Continue with GitHub'}
            </Button>
            <p className="text-xs text-muted-foreground">
              We only read your public profile and email.
            </p>
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {methods !== undefined && !methods.githubEnabled ? (
          <div className="space-y-2 text-left text-sm text-muted-foreground">
            <p>This workspace doesn&apos;t use GitHub sign-in.</p>
            <p>
              To connect, create an access token from the server and run{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">plandesk connect</code>, or run
              Plan Desk locally where no sign-in is needed.
            </p>
            <p>
              <a
                href="https://plandesk.asyncdot.com/self-hosting/server-config/"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Learn how to set up server sign-in →
              </a>
            </p>
          </div>
        ) : null}
      </Card>
    </AuthShell>
  );
}
