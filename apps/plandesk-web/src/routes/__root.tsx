import { Link, Outlet, createRootRoute, useLocation, useParams } from '@tanstack/react-router';
import { AccountMenu } from '../components/auth/AccountMenu.js';
import { AuthGate } from '../components/auth/AuthGate.js';
import { CommandMenu, CommandMenuProvider } from '../components/layout/CommandMenu.js';
import { Sidebar } from '../components/layout/Sidebar.js';
import { Toaster } from '@/components/ui/sonner';
import { useActiveWorkspace } from '../lib/auth.js';
import { useDocument, useNote, useProject, usePrototype } from '../lib/queries.js';

const VIEW_LABELS: Record<string, string> = {
  overview: 'Overview',
  board: 'Board',
  list: 'List',
  flow: 'Flow',
  goals: 'Goals',
  prototypes: 'Prototypes',
  notes: 'Notes',
  inbox: 'Inbox',
  documents: 'Documents',
};

/**
 * The record open under a list view, when the path names one —
 * `/projects/:id/documents/:docId` → `{ kind: 'documents', recordId }`.
 *
 * Without this the trail stops at "Documents" on a document page, so the deepest
 * crumb names the list you are not looking at and the open record appears
 * nowhere. The detail pages compensated with a lone back arrow, which loses the
 * path above it.
 */
/**
 * Project views that have a detail page under them, so the trail can name the
 * open record rather than stopping at the list you navigated away from.
 *
 * Add a kind here and the switches below stop compiling until each one handles
 * it. That is deliberate: `prototypes` shipped without being registered here
 * and its detail page silently read "… › Prototypes", reproducing the exact
 * bug this function was written to fix.
 */
const DETAIL_KINDS = ['documents', 'notes', 'prototypes'] as const;
type DetailKind = (typeof DETAIL_KINDS)[number];

function isDetailKind(value: string): value is DetailKind {
  return (DETAIL_KINDS as readonly string[]).includes(value);
}

export function detailFromPath(pathname: string): { kind: DetailKind; recordId: string } | null {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments[0] !== 'projects' || segments.length < 4) {
    return null;
  }
  const kind = segments[2];
  const recordId = segments[3];
  if (recordId === undefined || kind === undefined || !isDetailKind(kind)) {
    return null;
  }
  return { kind, recordId };
}

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
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Leading crumb: the active workspace, linking to the landing to switch workspace/org. */
function WorkspaceCrumb() {
  const active = useActiveWorkspace();
  const name = active?.name ?? 'Workspaces';
  return (
    <Link to="/" title="Switch workspace">
      {name}
    </Link>
  );
}

function LeafCrumb({ title }: { title: string | undefined }) {
  return (
    <>
      <ChevronRight />
      <b>{title ?? '…'}</b>
    </>
  );
}

// Split per kind so only the relevant query runs. These hooks are unguarded, so
// calling both with one id blanked would put a live-polling request on an empty
// path.
function DocumentCrumb({ recordId }: { recordId: string }) {
  const { data } = useDocument(recordId);
  return <LeafCrumb title={data?.title} />;
}

function NoteCrumb({ recordId }: { recordId: string }) {
  const { data } = useNote(recordId);
  return <LeafCrumb title={data?.title} />;
}

function PrototypeCrumb({ recordId }: { recordId: string }) {
  const { data } = usePrototype(recordId);
  return <LeafCrumb title={data?.name} />;
}

/** The view crumb becomes the way back once a record is open below it. */
function ViewBackLink({ id, kind, label }: { id: string; kind: DetailKind; label: string }) {
  switch (kind) {
    case 'documents':
      return (
        <Link to="/projects/$id/documents" params={{ id }}>
          {label}
        </Link>
      );
    case 'notes':
      return (
        <Link to="/projects/$id/notes" params={{ id }}>
          {label}
        </Link>
      );
    case 'prototypes':
      return (
        <Link to="/projects/$id/prototypes" params={{ id }}>
          {label}
        </Link>
      );
    default: {
      // Annotation, never `as never` — an assertion compiles regardless and
      // would let a new kind slip through exactly as prototypes did.
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function DetailCrumb({ kind, recordId }: { kind: DetailKind; recordId: string }) {
  switch (kind) {
    case 'documents':
      return <DocumentCrumb recordId={recordId} />;
    case 'notes':
      return <NoteCrumb recordId={recordId} />;
    case 'prototypes':
      return <PrototypeCrumb recordId={recordId} />;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function ProjectCrumb({
  id,
  viewLabel,
  detail,
}: {
  id: string;
  viewLabel: string | null;
  detail: { kind: DetailKind; recordId: string } | null;
}) {
  const { data: project } = useProject(id);
  const name = project?.name ?? '…';
  return (
    <>
      <ChevronRight />
      {viewLabel !== null ? (
        <Link to="/projects/$id/board" params={{ id }}>
          {name}
        </Link>
      ) : (
        <b>{name}</b>
      )}
      {viewLabel !== null ? (
        <>
          <ChevronRight />
          {/* With a record open the view is no longer the leaf — make it the way back. */}
          {detail === null ? (
            <b>{viewLabel}</b>
          ) : (
            <ViewBackLink id={id} kind={detail.kind} label={viewLabel} />
          )}
        </>
      ) : null}
      {detail === null ? null : <DetailCrumb kind={detail.kind} recordId={detail.recordId} />}
    </>
  );
}

function Crumb() {
  const params = useParams({ strict: false });
  const location = useLocation();
  const viewLabel = viewLabelFromPath(location.pathname);
  const detail = detailFromPath(location.pathname);
  const id = params.id;
  return (
    <>
      <WorkspaceCrumb />
      {id !== undefined ? (
        <ProjectCrumb id={id} viewLabel={viewLabel} detail={detail} />
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

/**
 * A prototype canvas owns the whole viewport, the way a Figma file does.
 *
 * Rendered inside the shell it kept a 244px sidebar, a 48px breadcrumb topbar
 * and 24px of `.content` padding, none of which steers a canvas — together with
 * the always-open comments rail that left the artwork under half the window on
 * a 1440×900 screen. The canvas draws its own floating chrome instead, back
 * link included, so nothing here is lost — only re-homed.
 *
 * Covers the authoring route (`/projects/:id/prototypes/:prototypeId`), the
 * client share portal (`/p/:shareToken/prototypes/:prototypeId`), and preview
 * mode under either (`…/present/:screenId`), which is a whole-window surface
 * for the same reason.
 */
export function isCanvasPath(pathname: string): boolean {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const root = segments[0];
  if (root !== 'projects' && root !== 'p') {
    return false;
  }
  if (segments[2] !== 'prototypes') {
    return false;
  }
  if (segments.length === 4) {
    return true;
  }
  return segments.length === 6 && segments[4] === 'present';
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
  const isCanvas = isCanvasPath(location.pathname);
  const shell = <AppShell showAccount={!isPortal} />;

  if (isInvite) {
    return (
      <CommandMenuProvider>
        <Outlet />
      </CommandMenuProvider>
    );
  }
  // Chromeless before the portal branch: a shared canvas is a canvas too.
  if (isCanvas) {
    return (
      <CommandMenuProvider>
        {isPortal ? (
          <Outlet />
        ) : (
          <AuthGate>
            <Outlet />
          </AuthGate>
        )}
        <Toaster />
      </CommandMenuProvider>
    );
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
