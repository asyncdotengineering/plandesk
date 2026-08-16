import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { WorkspaceClientView } from '../../lib/portal.js';
import { PortalPage } from './PortalPage.js';

type PortalWorkspacePageProps = {
  view: WorkspaceClientView;
  shareToken: string;
  sessionToken: string;
  onUnauthorized: () => void;
};

export function PortalWorkspacePage({
  view,
  shareToken,
  sessionToken,
  onUnauthorized,
}: PortalWorkspacePageProps) {
  const projects = view.projects;
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? '');
  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];

  if (selected === undefined) {
    return (
      <section className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="mb-2 text-xl font-semibold">{view.workspace.name}</h1>
        <p className="text-sm text-muted-foreground">This workspace has no shared projects yet.</p>
      </section>
    );
  }

  return (
    <article data-portal-view data-portal-workspace className="mx-auto max-w-5xl px-5 py-6 pb-16">
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-start gap-3">
          <h1 className="flex-1 text-2xl font-bold tracking-tight">{view.workspace.name}</h1>
          <Badge variant="secondary" className="shrink-0 text-[11px] font-semibold">
            workspace, read-only
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Shared with {view.share.audience_name} · {projects.length}{' '}
          {projects.length === 1 ? 'project' : 'projects'}
        </p>
      </header>

      <nav aria-label="Projects in this workspace" className="mb-6">
        <ul
          role="tablist"
          className="m-0 flex flex-wrap gap-2 rounded-lg border border-border bg-card p-2"
        >
          {projects.map((project) => {
            const active = project.id === selected.id;
            return (
              <li key={project.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-portal-project-tab={project.id}
                  onClick={() => {
                    setSelectedId(project.id);
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {project.name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div data-portal-selected-project={selected.id}>
        <PortalPage
          view={selected.view}
          shareToken={shareToken}
          sessionToken={sessionToken}
          projectId={selected.id}
          onUnauthorized={onUnauthorized}
        />
      </div>
    </article>
  );
}
