import { useAuthSession, useLogout } from '../../lib/auth.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Current org + role, and sign-out for a browser session.
 *
 * A token or loopback caller has no session to end, so no sign-out is offered
 * there — that is the only place the transport shows through in the UI.
 */
export function AccountMenu() {
  const { data: session } = useAuthSession();
  const signOut = useLogout();

  if (session === null || session === undefined) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {session.org !== null ? (
        <span className="text-sm text-muted-foreground">{session.org.name}</span>
      ) : null}
      <Badge variant="secondary">{session.role}</Badge>
      {session.kind === 'session' ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={signOut.isPending}
          onClick={() => {
            signOut.mutate();
          }}
        >
          Sign out
        </Button>
      ) : null}
    </div>
  );
}
