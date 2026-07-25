import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, type InviteRole } from '../../lib/api.js';
import { useAuthSession } from '../../lib/auth.js';
import {
  useAddWorkspaceMember,
  useCreateOrgInvitation,
  useOrgMembers,
  useRemoveWorkspaceMember,
  useWorkspaceMembers,
} from '../../lib/queries.js';

/**
 * Workspace member roster + owner-gated add/remove + workspace-scoped invites.
 *
 * better-auth's team-member rows carry only userId; we join with the org member
 * roster for display (a workspace member is always an org member). Invites
 * target this workspace (team_id); accepting joins the team, not just the org.
 */
export function WorkspaceMembers() {
  const session = useAuthSession();
  const role = session.data?.role;
  const isOwner = role === 'owner';
  // Org roles are the ladder in api.orgRoles; owners and managers may invite.
  const canInvite = role === 'owner' || role === 'manager';
  const orgId = session.data?.org?.id;
  const activeWorkspaceId = session.data?.active_workspace?.id;
  const activeWorkspaceName = session.data?.active_workspace?.name;

  const membersQuery = useWorkspaceMembers(activeWorkspaceId);
  const orgMembersQuery = useOrgMembers(orgId);
  const addMutation = useAddWorkspaceMember(activeWorkspaceId);
  const removeMutation = useRemoveWorkspaceMember(activeWorkspaceId);
  const inviteMutation = useCreateOrgInvitation(orgId);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('member');
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canInvite || activeWorkspaceId === undefined) {
      return;
    }
    try {
      const created = await inviteMutation.mutateAsync({
        email: inviteEmail.trim(),
        role: inviteRole,
        teamId: activeWorkspaceId,
      });
      setClaimUrl(created.claimUrl);
      setCopied(false);
      setInviteEmail('');
      toast('Invitation created');
    } catch {
      // surfaced via inviteMutation.isError
    }
  }

  async function handleCopy() {
    if (claimUrl === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(claimUrl);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
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

      {canInvite ? (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold">Invite to workspace</CardTitle>
            <CardDescription>
              {activeWorkspaceName !== undefined && activeWorkspaceName.length > 0
                ? `Invite a new person to ${activeWorkspaceName}. `
                : 'Invite a new person to this workspace. '}
              Plan Desk creates a claim link — it does not send email.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="grid gap-4" onSubmit={(event) => void handleInvite(event)}>
              <div className="grid gap-2">
                <Label htmlFor="workspace-invite-email">Email</Label>
                <Input
                  id="workspace-invite-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workspace-invite-role">Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(value) => setInviteRole(value as InviteRole)}
                >
                  <SelectTrigger id="workspace-invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                disabled={inviteMutation.isPending || inviteEmail.trim() === ''}
              >
                {inviteMutation.isPending ? 'Inviting…' : 'Invite'}
              </Button>
              {inviteMutation.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {inviteMutation.error instanceof ApiError && inviteMutation.error.status === 403
                    ? 'You do not have permission to invite members.'
                    : 'Failed to create invitation.'}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {claimUrl !== null ? (
        <Card className="border-[var(--s-prog-dot)] bg-[var(--s-prog-bg)]">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-[var(--s-prog-fg)]">
              Claim link
            </CardTitle>
            <CardDescription className="text-[var(--s-prog-fg)]/80">
              Invites are link-only. Copy this URL and send it to the invitee yourself.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <code className="block break-all rounded-md border border-border bg-card px-3 py-2.5 font-mono text-xs">
              {claimUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? 'Copied' : 'Copy claim link'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold">Add member</CardTitle>
            <CardDescription>Add an existing org member to this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="grid gap-4" onSubmit={(event) => void handleAdd(event)}>
              <Select name="userId" disabled={addMutation.isPending || addable.length === 0}>
                <SelectTrigger id="workspace-add-member" aria-label="Member to add">
                  <SelectValue
                    placeholder={
                      addable.length === 0 ? 'Everyone is already a member' : 'Select a member'
                    }
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
