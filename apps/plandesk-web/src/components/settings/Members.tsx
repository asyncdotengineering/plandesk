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
import { useCreateOrgInvitation, useOrgMembers } from '../../lib/queries.js';

export function Members() {
  const session = useAuthSession();
  const orgId = session.data?.org?.id;
  const role = session.data?.role;
  const canInvite = role === 'owner' || role === 'admin';

  const membersQuery = useOrgMembers(orgId);
  const inviteMutation = useCreateOrgInvitation(orgId);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('member');
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    if (!canInvite) {
      return;
    }
    try {
      const created = await inviteMutation.mutateAsync({
        email: email.trim(),
        role: inviteRole,
      });
      setClaimUrl(created.claimUrl);
      setCopied(false);
      setEmail('');
      toast('Invitation created');
    } catch {
      // Error surface via inviteMutation.isError
    }
  }

  async function handleCopy() {
    if (claimUrl === null) {
      return;
    }
    await navigator.clipboard.writeText(claimUrl);
    setCopied(true);
  }

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (orgId === undefined) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Sign in to an organization to manage members.
      </p>
    );
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">Members</CardTitle>
          <CardDescription>People who already belong to this organization.</CardDescription>
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

      {canInvite ? (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold">Invite teammate</CardTitle>
            <CardDescription>
              Create a claim link and deliver it by hand — Plan Desk does not send email.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="grid gap-4" onSubmit={(e) => void handleInvite(e)}>
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(value) => setInviteRole(value as InviteRole)}
                >
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={inviteMutation.isPending || email.trim() === ''}>
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
    </div>
  );
}
