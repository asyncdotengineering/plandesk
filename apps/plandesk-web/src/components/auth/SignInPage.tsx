import { useState } from 'react';
import { startGithubSignIn } from '../../lib/api.js';
import { useAuthMethods } from '../../lib/auth.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Shown whenever the API says nobody is signed in.
 *
 * GitHub is a convenience, never a requirement: an instance with no GitHub app
 * configured shows the token path instead (REQ-20). GitHub uses better-auth
 * social login (BA4c) so the browser ends up with a better-auth session cookie.
 */
export function SignInPage() {
  const { data: methods, isLoading } = useAuthMethods();
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
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Sign in to Plan Desk</h1>
          <p className="text-sm text-muted-foreground">
            Your board is scoped to your organisation.
          </p>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Checking sign-in options…</p> : null}

        {methods?.githubEnabled === true ? (
          <Button
            type="button"
            className="w-full"
            disabled={starting}
            onClick={() => {
              void onGithubSignIn();
            }}
          >
            Continue with GitHub
          </Button>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {methods !== undefined && !methods.githubEnabled ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>This instance does not use GitHub sign-in.</p>
            <p>
              Create an API token on the server and connect with{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">plandesk connect</code>, or run
              the dashboard locally where no sign-in is needed.
            </p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
