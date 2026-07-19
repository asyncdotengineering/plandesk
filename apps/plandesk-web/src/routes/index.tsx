import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandMark } from '../components/auth/AuthShell.js';
import { ThemeToggle } from '../components/layout/ThemeToggle.js';
import { ApiError } from '../lib/api.js';
import { useActiveWorkspace, useAuthSession, useSetActiveWorkspace, useWorkspaces } from '../lib/auth.js';
import { useCreateWorkspace, useProjects } from '../lib/queries.js';

/**
 * Chromeless workspace landing — NO app sidebar. Centered Plan Desk wordmark +
 * org name, then a grid of workspaces (with their project counts). Selecting a
 * workspace sets it active and enters the sidebar'd project list. The sidebar'd
 * layout still owns /projects/* and deeper routes; only this index is chromeless.
 *
 * Rendered rootless by __root.tsx (see ROOTLESS_PATHS) so no AppShell wraps it.
 */
function WorkspaceLanding() {
  const { data: session } = useAuthSession();
  const workspacesQuery = useWorkspaces();
  const { data: projects } = useProjects();
  const setActive = useSetActiveWorkspace();
  const createWorkspace = useCreateWorkspace();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');

  const workspaces = workspacesQuery.data ?? session?.workspaces ?? [];
  const orgName = session?.org?.name ?? 'Your organization';
  const isOwner = session?.role === 'owner';
  const activeWorkspaceId = useActiveWorkspace()?.id;

  const projectCountByWorkspace = new Map<string, number>();
  if (projects !== undefined) {
    for (const project of projects) {
      projectCountByWorkspace.set(
        project.workspace_id,
        (projectCountByWorkspace.get(project.workspace_id) ?? 0) + 1,
      );
    }
  }

  function enterWorkspace(workspaceId: string) {
    // Switching the active workspace invalidates every org-scoped query; once
    // it resolves the project list reads the new workspace's projects.
    setActive.mutate(workspaceId, {
      onSuccess: () => {
        void navigate({ to: '/projects' });
      },
    });
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    try {
      const created = await createWorkspace.mutateAsync(trimmed);
      setName('');
      setCreateOpen(false);
      await setActive.mutateAsync(created.id);
      toast('Workspace created');
      void navigate({ to: '/projects' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("You don't have permission to create workspaces.");
      }
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--border-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 62% 52% at 50% 42%, #000 0%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 62% 52% at 50% 42%, #000 0%, transparent 76%)',
          opacity: 0.55,
        }}
      />
      {/* Theme toggle in the corner — the landing has no sidebar, so expose it here. */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-4">
          <BrandMark />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Plan Desk</h1>
            <p className="mt-1 text-sm text-muted-foreground">{orgName}</p>
          </div>
        </div>

        <div className="w-full">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Workspaces
            </h2>
            {isOwner ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                <PlusIcon className="size-3.5" /> New workspace
              </Button>
            ) : null}
          </div>

          {workspacesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading workspaces…</p>
          ) : workspacesQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              Failed to load workspaces: {workspacesQuery.error.message}
            </p>
          ) : workspaces.length === 0 ? (
            <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              No workspaces yet.{isOwner ? ' Create one to get started.' : ''}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {workspaces.map((workspace) => {
                const count = projectCountByWorkspace.get(workspace.id) ?? 0;
                const isActive = workspace.id === activeWorkspaceId;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => {
                      enterWorkspace(workspace.id);
                    }}
                    disabled={setActive.isPending}
                    aria-label={`Open workspace ${workspace.name}`}
                    className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <span aria-hidden className="text-sm font-semibold">
                        {workspace.name.slice(0, 1).toUpperCase()}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {workspace.name}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {count} {count === 1 ? 'project' : 'projects'}
                      </span>
                    </span>
                    {isActive ? (
                      <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Active
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A new workspace starts empty. Pick it on the landing to add projects.
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
                disabled={createWorkspace.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createWorkspace.isPending || name.trim() === ''}>
                {createWorkspace.isPending ? 'Creating…' : 'Create workspace'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: WorkspaceLanding,
});
