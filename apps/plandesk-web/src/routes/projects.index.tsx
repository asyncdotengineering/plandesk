import { Link, createFileRoute } from '@tanstack/react-router';
import { FolderKanbanIcon } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoveProjectDialog } from '../components/projects/MoveProjectDialog.js';
import { useActiveWorkspace, useAuthSession } from '../lib/auth.js';
import { useCreateProject, useProjects } from '../lib/queries.js';

/**
 * The active workspace's project list. Reached from the workspace landing
 * (routes/index.tsx) once a workspace is chosen — the landing handles the
 * workspace selection, this screen handles projects inside the active one.
 */
export function ProjectListPage() {
  const { data: session } = useAuthSession();
  const activeWorkspace = useActiveWorkspace();
  const activeWorkspaceId = activeWorkspace?.id;
  const workspaces = session?.workspaces ?? [];
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const [name, setName] = useState('');

  const visibleProjects =
    projects === undefined || activeWorkspaceId === undefined
      ? projects
      : projects.filter((project) => project.workspace_id === activeWorkspaceId);

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    createProject.mutate(
      {
        name: trimmed,
        ...(activeWorkspaceId !== undefined ? { workspace_id: activeWorkspaceId } : {}),
      },
      {
        onSuccess: () => {
          setName('');
          toast('Project created');
        },
      },
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading projects…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load projects: {error.message}
      </p>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">Projects</h2>
          <span className="text-xs text-muted-foreground">
            {activeWorkspace?.name ?? 'Your workspaces'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
          <Input
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="New project name"
            aria-label="Project name"
            className="flex-1"
          />
          <Button type="submit" disabled={createProject.isPending || name.trim() === ''}>
            {createProject.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </form>

        {createProject.isError ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            Failed to create project: {createProject.error.message}
          </p>
        ) : null}

        {visibleProjects !== undefined && visibleProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet. Create one above.</p>
        ) : (
          <div className="grid gap-2">
            {visibleProjects?.map((project) => (
              <Link
                key={project.id}
                to="/projects/$id/board"
                params={{ id: project.id }}
                className="block"
              >
                <Card className="flex items-start gap-3 border p-3.5 shadow-sm transition-colors hover:border-border hover:bg-muted/30">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FolderKanbanIcon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-snug">{project.name}</p>
                    {project.description ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {project.description}
                      </p>
                    ) : null}
                  </div>
                  <MoveProjectDialog project={project} workspaces={workspaces} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/projects/')({
  component: ProjectListPage,
});
