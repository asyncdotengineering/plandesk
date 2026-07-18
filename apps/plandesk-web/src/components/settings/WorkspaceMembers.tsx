import { type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '../../lib/api.js';
import { useAuthSession } from '../../lib/auth.js';
import {
  useAddWorkspaceMember,
  useOrgMembers,
  useRemoveWorkspaceMember,
  useWorkspaceMembers,
} from '../../lib/queries.js';

/**
 * Workspace member roster + owner-gated add/remove.
 *
 * better-auth's team-member rows carry only userId; we join with the org member
 * roster for display (a workspace member is always an org member).
 */
export function WorkspaceMembers() {
  const session = useAuthSession();
  const isOwner = session.data?.role === 'owner';
  const orgId = session.data?.org?.id;
  const activeWorkspaceId = session.data?.active_workspace?.id;

  const membersQuery = useWorkspaceMembers(activeWorkspaceId);
  const orgMembersQuery = useOrgMembers(orgId);
  const addMutation = useAddWorkspaceMember(activeWorkspaceId);
  const removeMutation = useRemoveWorkspaceMember(activeWorkspaceId);

  const memberUserIds = new Set(membersQuery.data?.map((member) => member.userId));
  const displayByUserId = new Map(
    (orgMembersQuery.data?.members ?? []).map((member) => [
      member.userId,
      { name: member.name, email: member.email, role: member.role },
    ]),
  );
  const addable = (orgMembersQuery.data?.members ?? []).filter(
    (member) => !memberUserIds.has(member.userId),
  );

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const userId = new FormData(form).get('userId');
    if (typeof userId !== 'string' || userId.length === 0) {
      return;
    }
    try {
      await addMutation.mutateAsync(userId);
      form.reset();
      toast('Member added');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to manage workspace members.");
      }
    }
  }

  async function handleRemove(userId: string) {
    if (!isOwner) {
      return;
    }
    if (!window.confirm('Remove this member from the workspace?')) {
      return;
    }
    try {
      await removeMutation.mutateAsync(userId);
      toast('Member removed');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to manage workspace members.");
      }
    }
  }

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (activeWorkspaceId === undefined) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Select a workspace to manage its members.
      </p>
    );
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">Workspace members</CardTitle>
          <CardDescription>
            People with access to the active workspace and its projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {membersQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading members…</p>
          ) : null}
          {membersQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Failed to load workspace members.
            </p>
          ) : null}
          {membersQuery.data !== undefined ? (
            membersQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {membersQuery.data.map((member) => {
                  const display = displayByUserId.get(member.userId);
                  return (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {display?.name || display?.email || member.userId}
                        </div>
                        {display?.email ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {display.email}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {display?.role ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                            {display.role}
                          </span>
                        ) : null}
                        {isOwner ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove member ${display?.name ?? member.userId}`}
                            disabled={removeMutation.isPending}
                            onClick={() => {
                              void handleRemove(member.userId);
                            }}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold">Add member</CardTitle>
            <CardDescription>
              Add an existing org member to this workspace. Invite new people from the org Members
              tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="grid gap-4" onSubmit={(event) => void handleAdd(event)}>
              <Select name="userId" disabled={addMutation.isPending || addable.length === 0}>
                <SelectTrigger id="workspace-add-member" aria-label="Member to add">
                  <SelectValue
                    placeholder={addable.length === 0 ? 'Everyone is already a member' : 'Select a member'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {addable.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name || member.email || member.userId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={addMutation.isPending || addable.length === 0}>
                {addMutation.isPending ? 'Adding…' : 'Add to workspace'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
