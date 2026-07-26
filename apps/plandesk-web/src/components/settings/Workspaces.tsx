import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '../../lib/api.js';
import { useAuthSession, useWorkspaces } from '../../lib/auth.js';
import { useCreateWorkspace, useDeleteWorkspace, useRenameWorkspace } from '../../lib/queries.js';
import { WorkspaceShareButton } from './WorkspaceShareButton.js';
import { QueryFailure } from './QueryFailure.js';

type Editing = { id: string; name: string } | null;

export function Workspaces() {
  const session = useAuthSession();
  const isOwner = session.data?.role === 'owner';
  const workspacesQuery = useWorkspaces();
  const createMutation = useCreateWorkspace();
  const renameMutation = useRenameWorkspace();
  const deleteMutation = useDeleteWorkspace();

  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Editing>(null);

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner) {
      return;
    }
    try {
      await createMutation.mutateAsync(name.trim());
      setName('');
      toast('Workspace created');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to create workspaces.");
      }
    }
  }

  async function handleRename() {
    if (editing === null || editing.name.trim() === '') {
      return;
    }
    try {
      await renameMutation.mutateAsync({ teamId: editing.id, name: editing.name.trim() });
      setEditing(null);
      toast('Workspace renamed');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to rename workspaces.");
      }
    }
  }

  async function handleDelete(teamId: string) {
    if (!isOwner) {
      return;
    }
    if (
      !window.confirm('Delete this workspace? Projects in it are not deleted but become orphaned.')
    ) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(teamId);
      toast('Workspace deleted');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to delete workspaces.");
      }
    }
  }

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (session.isError) {
    return (
      <QueryFailure
        message="Failed to load the current session."
        onRetry={() => {
          void session.refetch();
        }}
        isRetrying={session.isFetching}
      />
    );
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm font-semibold">Workspaces</CardTitle>
          <CardDescription>
            Each workspace groups projects and members. New projects land in the active workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {workspacesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading workspaces…</p>
          ) : null}
          {workspacesQuery.isError ? (
            <QueryFailure
              message="Failed to load workspaces."
              onRetry={() => {
                void workspacesQuery.refetch();
              }}
              isRetrying={workspacesQuery.isFetching}
            />
          ) : null}
          {workspacesQuery.data !== undefined ? (
            workspacesQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {workspacesQuery.data.map((workspace) => {
                  const isActive = session.data?.active_workspace?.id === workspace.id;
                  return (
                    <li
                      key={workspace.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                    >
                      {editing !== null && editing.id === workspace.id ? (
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <Input
                            aria-label={`Rename ${workspace.name}`}
                            value={editing.name}
                            onChange={(event) => {
                              setEditing({ id: workspace.id, name: event.target.value });
                            }}
                            className="max-w-xs"
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              void handleRename();
                            }}
                            disabled={renameMutation.isPending || editing.name.trim() === ''}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <span className="truncate font-medium">{workspace.name}</span>
                            {isActive ? (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                                Active
                              </span>
                            ) : null}
                          </div>
                          {isOwner ? (
                            <div className="flex items-center gap-1">
                              <WorkspaceShareButton
                                workspaceId={workspace.id}
                                workspaceName={workspace.name}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Rename ${workspace.name}`}
                                onClick={() => {
                                  setEditing({ id: workspace.id, name: workspace.name });
                                }}
                              >
                                Rename
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Delete ${workspace.name}`}
                                disabled={deleteMutation.isPending}
                                onClick={() => {
                                  void handleDelete(workspace.id);
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          ) : null}
                        </>
                      )}
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
            <CardTitle className="text-sm font-semibold">Create workspace</CardTitle>
            <CardDescription>
              A new workspace starts empty. Invite members from its tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                void handleCreate(event);
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="workspace-name">Name</Label>
                <Input
                  id="workspace-name"
                  type="text"
                  required
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  placeholder="Fiji TV"
                />
              </div>
              <Button type="submit" disabled={createMutation.isPending || name.trim() === ''}>
                {createMutation.isPending ? 'Creating…' : 'Create workspace'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
