import { Outlet, createRootRoute, useLocation, useParams } from '@tanstack/react-router';
import { Sidebar } from '../components/layout/Sidebar.js';
import { Toaster } from '@/components/ui/sonner';
import { useSseInvalidation } from '../lib/events.js';
import { useProject } from '../lib/queries.js';

const VIEW_LABELS: Record<string, string> = {
  overview: 'Overview',
  board: 'Board',
  flow: 'Flow',
  goals: 'Goals',
  notes: 'Notes',
  inbox: 'Inbox',
  // Documents live under Overview (there is no separate Docs tab), so a document
  // page reads as "Project › Overview" rather than a phantom "Docs" section.
  documents: 'Overview',
};

function viewLabelFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments[0] === 'projects' && segments.length >= 3) {
    const key = segments[2];
    if (key === undefined) {
      return null;
    }
    return VIEW_LABELS[key] ?? null;
  }
  if (segments[0] === 'settings' && segments[1] === 'mcp') {
    return 'MCP Settings';
  }
  return null;
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ProjectCrumb({ id, viewLabel }: { id: string; viewLabel: string | null }) {
  const { data: project } = useProject(id);
  return (
    <>
      <span>{project?.name ?? ''}</span>
      {viewLabel !== null ? (
        <>
          <ChevronRight />
          <b>{viewLabel}</b>
        </>
      ) : null}
    </>
  );
}

function Crumb() {
  const params = useParams({ strict: false });
  const location = useLocation();
  const viewLabel = viewLabelFromPath(location.pathname);
  const id = params.id;
  if (id === undefined) {
    return <b>{viewLabel ?? 'Projects'}</b>;
  }
  return <ProjectCrumb id={id} viewLabel={viewLabel} />;
}

function RootLayout() {
  useSseInvalidation();

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <nav className="crumb">
            <Crumb />
          </nav>
          <div className="spacer" />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
