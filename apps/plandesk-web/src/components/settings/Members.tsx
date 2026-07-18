import { useAuthSession } from '../../lib/auth.js';
import { useOrgMembers } from '../../lib/queries.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Read-only org roster. Invitations are workspace-scoped — invite from the
 * Workspaces tab (WorkspaceMembers). This view exists to show every org member
 * across workspaces.
 */
export function Members() {
  const session = useAuthSession();
  const orgId = session.data?.org?.id;

  const membersQuery = useOrgMembers(orgId);

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (orgId === undefined) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Sign in to an organization to view members.
      </p>
    );
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">Members</CardTitle>
          <CardDescription>
            Everyone in this organization. Invite to a specific workspace from the Workspaces tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {membersQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading members…</p>
          ) : null}
          {membersQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Failed to load members.
            </p>
          ) : null}
          {membersQuery.data !== undefined ? (
            membersQuery.data.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {membersQuery.data.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {member.name || member.email || member.userId}
                      </div>
                      {member.email ? (
                        <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                      {member.role}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
