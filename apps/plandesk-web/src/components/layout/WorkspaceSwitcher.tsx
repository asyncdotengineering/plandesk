import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '../../lib/api.js';
import {
  useActiveWorkspace,
  useAuthSession,
  useSetActiveWorkspace,
  useWorkspaces,
} from '../../lib/auth.js';
import { useCreateWorkspace } from '../../lib/queries.js';

/**
 * Sidebar workspace switcher: lists the active org's workspaces, calls
 * setActiveWorkspace on select (which invalidates every org-scoped query —
 * including projects — on success), and exposes an owner-gated inline
 * "new workspace" affordance.
 */
export function WorkspaceSwitcher() {
  const { data: session } = useAuthSession();
  const workspacesQuery = useWorkspaces();
  const setActive = useSetActiveWorkspace();
  const createMutation = useCreateWorkspace();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');

  // The session caches workspaces + active_workspace; the workspaces query is
  // the fresh list for CRUD. Prefer the fresh list once it resolves.
  const workspaces = workspacesQuery.data ?? session?.workspaces ?? [];
  const active = useActiveWorkspace();
  const isOwner = session?.role === 'owner';

  const label = active?.name ?? 'Workspaces';
  const showPicker = workspaces.length > 1;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    try {
      const created = await createMutation.mutateAsync(trimmed);
      setName('');
      setCreateOpen(false);
      // Land the user in the workspace they just made.
      await setActive.mutateAsync(created.id);
      toast('Workspace created');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to create workspaces.");
      }
    }
  }

  return (
    <div className="switcher-row">
      {showPicker ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="switcher"
              aria-label={`Switch workspace (current: ${label})`}
              disabled={setActive.isPending}
            >
              <span aria-hidden="true">▣</span>
              <span className="switcher-name">{label}</span>
              <span className="switcher-chev" aria-hidden="true">
                ⌄
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((workspace) => {
              const isActive = active !== null && workspace.id === active.id;
              return (
                <DropdownMenuItem
                  key={workspace.id}
                  disabled={isActive || setActive.isPending}
                  onSelect={() => {
                    setActive.mutate(workspace.id);
                  }}
                >
                  <span className="switcher-name">{workspace.name}</span>
                  {isActive ? (
                    <span aria-label="Current" className="switcher-mark">
                      ✓
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="switcher" data-disabled aria-label={`Active workspace: ${label}`}>
          <span aria-hidden="true">▣</span>
          <span className="switcher-name">{label}</span>
        </div>
      )}
      {isOwner ? (
        <button
          type="button"
          className="switcher-add"
          aria-label="New workspace"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          ＋
        </button>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A new workspace starts empty. Invite members from its tab.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void handleCreate(event)}>
            <div className="grid gap-2">
              <Label htmlFor="new-workspace-name">Name</Label>
              <Input
                id="new-workspace-name"
                type="text"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Fiji TV"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || name.trim() === ''}>
                {createMutation.isPending ? 'Creating…' : 'Create workspace'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
