import { Link, Outlet, createRootRoute, useLocation, useParams } from '@tanstack/react-router';
import { AccountMenu } from '../components/auth/AccountMenu.js';
import { AuthGate } from '../components/auth/AuthGate.js';
import { CommandMenu, CommandMenuProvider } from '../components/layout/CommandMenu.js';
import { Sidebar } from '../components/layout/Sidebar.js';
import { Toaster } from '@/components/ui/sonner';
import { useAuthSession } from '../lib/auth.js';
import { useProject } from '../lib/queries.js';

const VIEW_LABELS: Record<string, string> = {
  overview: 'Overview',
  board: 'Board',
  flow: 'Flow',
  goals: 'Goals',
  notes: 'Notes',
  inbox: 'Inbox',
  documents: 'Documents',
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
  if (segments[0] === 'settings' && segments[1] === 'members') {
    return 'Members';
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

/** Leading crumb: the active workspace, linking to the landing to switch workspace/org. */
function WorkspaceCrumb() {
  const { data: session } = useAuthSession();
  const name = session?.active_workspace?.name ?? 'Workspaces';
  return (
    <Link to="/" title="Switch workspace">
      {name}
    </Link>
  );
}

function ProjectCrumb({ id, viewLabel }: { id: string; viewLabel: string | null }) {
  const { data: project } = useProject(id);
  const name = project?.name ?? '…';
  return (
    <>
      <ChevronRight />
      {viewLabel !== null ? (
        <Link to="/projects/$id/overview" params={{ id }}>
          {name}
        </Link>
      ) : (
        <b>{name}</b>
      )}
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
  return (
    <>
      <WorkspaceCrumb />
      {id !== undefined ? (
        <ProjectCrumb id={id} viewLabel={viewLabel} />
      ) : viewLabel !== null ? (
        <>
          <ChevronRight />
          <b>{viewLabel}</b>
        </>
      ) : null}
    </>
  );
}

/**
 * The client share portal is a public surface: an external participant holds a
 * share token, not an org membership, and authenticates against its own portal
 * API (see lib/portal.ts). Org sign-in must never gate them.
 */
const PORTAL_PATH_PREFIX = '/p/';
const INVITE_PATH_PREFIX = '/invite/';

/*
 * Routes rendered WITHOUT the AppShell (no sidebar / topbar). The workspace
 * landing (index) is the chromeless entry — it owns its own centered layout;
 * picking a workspace enters the sidebar'd project view.
 */
const ROOTLESS_PATHS = ['/'];

function isRootless(pathname: string): boolean {
  return ROOTLESS_PATHS.includes(pathname);
}

function AppShell({ showAccount }: { showAccount: boolean }) {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <nav className="crumb">
            <Crumb />
          </nav>
          <div className="spacer" />
          {showAccount ? <AccountMenu /> : null}
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <CommandMenu />
      <Toaster />
    </div>
  );
}

function RootLayout() {
  const location = useLocation();
  const isPortal = location.pathname.startsWith(PORTAL_PATH_PREFIX);
  // The invite claim page renders rootless (no AppShell) and outside the
  // AuthGate, so a signed-out invitee reaches it instead of the sign-in wall.
  const isInvite = location.pathname.startsWith(INVITE_PATH_PREFIX);
  const isLanding = isRootless(location.pathname);
  const shell = <AppShell showAccount={!isPortal} />;

  if (isInvite) {
    return <CommandMenuProvider><Outlet /></CommandMenuProvider>;
  }
  if (isPortal) {
    return <CommandMenuProvider>{shell}</CommandMenuProvider>;
  }
  // The landing still needs the AuthGate (signed-out → SignInPage) but no AppShell.
  if (isLanding) {
    return (
      <CommandMenuProvider>
        <AuthGate>
          <Outlet />
        </AuthGate>
        <Toaster />
      </CommandMenuProvider>
    );
  }
  return (
    <CommandMenuProvider>
      <AuthGate>{shell}</AuthGate>
    </CommandMenuProvider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
