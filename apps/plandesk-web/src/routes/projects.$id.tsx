import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { setActiveWorkspaceOverride } from '../lib/active-workspace.js';
import { ApiError } from '../lib/api.js';
import { useActiveWorkspace } from '../lib/auth.js';
import { useProject } from '../lib/queries.js';

function ProjectNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-muted-foreground">
        This project doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <p className="mt-4">
        <Link to="/projects" className="text-primary underline-offset-4 hover:underline">
          Back to projects
        </Link>
      </p>
    </div>
  );
}

function ProjectLayout() {
  const { id } = Route.useParams();
  const { data: project, error, isError } = useProject(id);
  const active = useActiveWorkspace();

  useEffect(() => {
    if (project !== undefined && project.workspace_id !== active?.id) {
      setActiveWorkspaceOverride(project.workspace_id);
    }
  }, [project, active?.id]);

  if (isError && error instanceof ApiError && error.status === 404) {
    return <ProjectNotFound />;
  }

  return <Outlet />;
}

export const Route = createFileRoute('/projects/$id')({
  component: ProjectLayout,
});
