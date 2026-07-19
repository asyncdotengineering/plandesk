import {
  useActiveWorkspace,
  useAuthSession,
  useLogout,
  useSetActiveOrganization,
  useSetActiveWorkspace,
} from '../../lib/auth.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Current org + role, and sign-out for a browser session.
 *
 * A token or loopback caller has no session to end, so no sign-out is offered
 * there — that is the only place the transport shows through in the UI.
 */
export function AccountMenu() {
  const { data: session } = useAuthSession();
  const signOut = useLogout();
  const switchOrganization = useSetActiveOrganization();
  const switchWorkspace = useSetActiveWorkspace();
  const activeWorkspace = useActiveWorkspace();

  if (session === null || session === undefined) {
    return null;
  }

  const orgs = session.orgs ?? (session.org === null ? [] : [{ ...session.org, role: session.role }]);
  const activeOrg = session.org;
  const workspaces = session.workspaces ?? [];

  return (
    <div className="flex items-center gap-2">
      {activeOrg !== null && orgs.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Switch organization (current: ${activeOrg.name})`}
              disabled={switchOrganization.isPending}
            >
              {activeOrg.name}
              <span aria-hidden="true">⌄</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                disabled={org.id === activeOrg.id || switchOrganization.isPending}
                onSelect={() => {
                  switchOrganization.mutate(org.id);
                }}
              >
                <span>{org.name}</span>
                {org.id === activeOrg.id ? <span aria-label="Current">✓</span> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : activeOrg !== null ? (
        <span className="text-sm text-muted-foreground">{activeOrg.name}</span>
      ) : null}
      {activeWorkspace !== null && workspaces.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Switch workspace (current: ${activeWorkspace.name})`}
              disabled={switchWorkspace.isPending}
            >
              <span aria-hidden="true">▣</span>
              {activeWorkspace.name}
              <span aria-hidden="true">⌄</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                disabled={
                  activeWorkspace !== null &&
                  (workspace.id === activeWorkspace.id || switchWorkspace.isPending)
                }
                onSelect={() => {
                  switchWorkspace.mutate(workspace.id);
                }}
              >
                <span>{workspace.name}</span>
                {activeWorkspace !== null && workspace.id === activeWorkspace.id ? (
                  <span aria-label="Current">✓</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : activeWorkspace !== null ? (
        <span className="text-sm text-muted-foreground">{activeWorkspace.name}</span>
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
