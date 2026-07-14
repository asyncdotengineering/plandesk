import type { ReactNode } from 'react';
import { useAuthSession } from '../../lib/auth.js';
import { SignInPage } from './SignInPage.js';

/**
 * Renders the app only for a caller the API recognises.
 *
 * `useAuthSession` maps 401 to null, so an unauthenticated browser lands on
 * sign-in rather than an error page. Local loopback resolves to an owner
 * session with no login at all (REQ-21), so this is invisible there.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data: session, isLoading, error } = useAuthSession();

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        Could not reach the Plan Desk API: {error.message}
      </p>
    );
  }

  if (session === null || session === undefined) {
    return <SignInPage />;
  }

  return <>{children}</>;
}
