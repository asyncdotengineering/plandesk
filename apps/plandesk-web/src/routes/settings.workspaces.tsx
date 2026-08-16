import { Link, createFileRoute } from '@tanstack/react-router';
import { Workspaces } from '../components/settings/Workspaces.js';
import { WorkspaceMembers } from '../components/settings/WorkspaceMembers.js';

function WorkspacesSettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">Workspaces</h2>
          <span className="text-xs text-muted-foreground">
            Create workspaces and manage who belongs to the active one.
          </span>
        </div>
        <nav className="mb-6 flex flex-wrap gap-3 text-sm" aria-label="Settings sections">
          <Link
            to="/settings/members"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Members
          </Link>
          <Link
            to="/settings/workspaces"
            className="font-medium text-foreground underline-offset-4"
          >
            Workspaces
          </Link>
          <Link
            to="/settings/mcp"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            MCP / CLI token
          </Link>
        </nav>
        <div className="mb-10">
          <Workspaces />
        </div>
        <div className="mb-10">
          <WorkspaceMembers />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings/workspaces')({
  component: WorkspacesSettingsPage,
});
