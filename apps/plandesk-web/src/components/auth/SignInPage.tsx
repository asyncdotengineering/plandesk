import { GITHUB_SIGN_IN_PATH } from '../../lib/api.js';
import { useAuthMethods } from '../../lib/auth.js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Shown whenever the API says nobody is signed in.
 *
 * GitHub is a convenience, never a requirement: an instance with no GitHub app
 * configured shows the token path instead (REQ-20).
 */
export function SignInPage() {
  const { data: methods, isLoading } = useAuthMethods();

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
          // Full-page navigation, not fetch: the OAuth redirect must leave the SPA.
          <Button asChild className="w-full">
            <a href={GITHUB_SIGN_IN_PATH}>Continue with GitHub</a>
          </Button>
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
