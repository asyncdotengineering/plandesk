import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveWorkspace } from '../../lib/auth.js';
import { useProjects } from '../../lib/queries.js';

/**
 * Sidebar project switcher: quick navigation between the active workspace's
 * projects. Navigation is delegated to the caller (the sidebar, which owns the
 * router) so this component stays router-free and unit-testable.
 */
export function ProjectSwitcher({
  activeProjectId,
  onNavigate,
}: {
  activeProjectId?: string;
  onNavigate: (projectId: string) => void;
}) {
  const { data: projects } = useProjects();
  const activeWorkspaceId = useActiveWorkspace()?.id;

  // Same client-side filter the projects list uses: only the active workspace.
  const visible =
    projects === undefined || activeWorkspaceId === undefined
      ? (projects ?? [])
      : projects.filter((project) => project.workspace_id === activeWorkspaceId);

  const active =
    activeProjectId !== undefined
      ? (visible.find((project) => project.id === activeProjectId) ?? null)
      : null;
  const label = active?.name ?? 'Projects';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="switcher"
          aria-label={`Switch project${active !== null ? ` (current: ${active.name})` : ''}`}
        >
          <span className="proj-dot" aria-hidden="true" />
          <span className="switcher-name">{label}</span>
          <span className="switcher-chev" aria-hidden="true">
            ⌄
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {visible.length === 0 ? (
          <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
        ) : (
          visible.map((project) => {
            const isActive = activeProjectId === project.id;
            return (
              <DropdownMenuItem
                key={project.id}
                disabled={isActive}
                onSelect={() => {
                  onNavigate(project.id);
                }}
              >
                <span className="switcher-name">{project.name}</span>
                {isActive ? (
                  <span aria-label="Current" className="switcher-mark">
                    ✓
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
