import { Link, useNavigate, useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SearchIcon, SettingsIcon } from 'lucide-react';
import { useCommandMenu } from './CommandMenu.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { ThemeToggle } from './ThemeToggle.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import './shell.css';

type NavEntry = {
  label: string;
  to: string;
  icon: ReactNode;
};

const PLAN_NAV: NavEntry[] = [
  {
    label: 'Overview',
    to: '/projects/$id/overview' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    label: 'Board',
    to: '/projects/$id/board' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
        <rect x="10" y="4" width="5" height="11" rx="1.5" />
        <rect x="16.5" y="4" width="4.5" height="8" rx="1.5" />
      </svg>
    ),
  },
  // List is a view of the board, not a destination of its own — it is reached
  // from the board's view switcher and stays addressable at /projects/$id/list.
  // A second sidebar entry pointing at the same data read as two places to go.
  {
    label: 'Flow',
    to: '/projects/$id/flow' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <circle cx="6" cy="7" r="2.4" />
        <circle cx="18" cy="12" r="2.4" />
        <circle cx="6" cy="17" r="2.4" />
        <path d="M8.3 7.6l7.4 3.6M8.2 16.2l7.5-3.4" />
      </svg>
    ),
  },
  {
    label: 'Goals',
    to: '/projects/$id/goals' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.4" />
      </svg>
    ),
  },
  {
    label: 'Prototypes',
    to: '/projects/$id/prototypes' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    ),
  },
];

const WORKSPACE_NAV: NavEntry[] = [
  {
    label: 'Documents',
    to: '/projects/$id/documents' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
        <path d="M14 3.5V8h4" />
      </svg>
    ),
  },
  {
    label: 'Notes',
    to: '/projects/$id/notes' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <path d="M5 19l1-4L16 5l3 3L9 18l-4 1z" />
      </svg>
    ),
  },
  {
    label: 'Inbox',
    to: '/projects/$id/inbox' as const,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
      >
        <path d="M4 13l2.2-7.2A2 2 0 0 1 8.1 4.5h7.8a2 2 0 0 1 1.9 1.3L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
        <path d="M4 13h4l1.5 2.2h5L16 13h4" />
      </svg>
    ),
  },
];

function NavRow({ entry, id }: { entry: NavEntry; id: string }) {
  return (
    <Link to={entry.to} params={{ id }} className="nav-item" activeProps={{ className: 'active' }}>
      {entry.icon}
      {entry.label}
    </Link>
  );
}

/**
 * `persistent` marks the copy that lives in the `.app` grid at desktop width.
 * The drawer renders the same component without it, so `shell.css` can hide one
 * and not the other.
 */
export function Sidebar({ persistent = false }: { persistent?: boolean }) {
  const params = useParams({ strict: false });
  const id = params.id;
  const { setOpen } = useCommandMenu();
  const navigate = useNavigate();

  return (
    <aside className="sidebar" {...(persistent ? { 'data-app-sidebar': '' } : {})}>
      <Link to="/" className="ws" aria-label="Plan Desk home">
        <div className="ws-badge">P</div>
        <span className="ws-name">Plan Desk</span>
      </Link>
      <div className="side-scroll">
        <WorkspaceSwitcher />
        <ProjectSwitcher
          activeProjectId={id}
          onNavigate={(projectId) => {
            void navigate({ to: '/projects/$id/board', params: { id: projectId } });
          }}
        />
        {id !== undefined ? (
          <>
            <div className="nav-label">Plan</div>
            {PLAN_NAV.map((entry) => (
              <NavRow key={entry.label} entry={entry} id={id} />
            ))}
            <div className="nav-label">Workspace</div>
            {WORKSPACE_NAV.map((entry) => (
              <NavRow key={entry.label} entry={entry} id={id} />
            ))}
          </>
        ) : null}
      </div>
      <div className="side-foot">
        <button
          type="button"
          className="cmdk"
          aria-label="Search or run a command"
          onClick={() => {
            setOpen(true);
          }}
        >
          <SearchIcon width={15} height={15} />
          <span>Search…</span>
          <span className="cmdk-keys">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        <ThemeToggle className="icon-btn" />
        <Link to="/settings/members" className="icon-btn" title="Settings" aria-label="Settings">
          <SettingsIcon width={17} height={17} />
        </Link>
      </div>
    </aside>
  );
}
