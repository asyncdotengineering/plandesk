import { Link, useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useProject } from '../../lib/queries.js';
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    label: 'Board',
    to: '/projects/$id/board' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
        <rect x="10" y="4" width="5" height="11" rx="1.5" />
        <rect x="16.5" y="4" width="4.5" height="8" rx="1.5" />
      </svg>
    ),
  },
  {
    label: 'Flow',
    to: '/projects/$id/flow' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.4" />
      </svg>
    ),
  },
];

const WORKSPACE_NAV: NavEntry[] = [
  // No dedicated docs route exists yet; overview renders the documents tree.
  {
    label: 'Docs',
    to: '/projects/$id/overview' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
        <path d="M14 3.5V8h4" />
      </svg>
    ),
  },
  {
    label: 'Notes',
    to: '/projects/$id/notes' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M5 19l1-4L16 5l3 3L9 18l-4 1z" />
      </svg>
    ),
  },
  {
    label: 'Inbox',
    to: '/projects/$id/inbox' as const,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <path d="M4 13l2.2-7.2A2 2 0 0 1 8.1 4.5h7.8a2 2 0 0 1 1.9 1.3L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
        <path d="M4 13h4l1.5 2.2h5L16 13h4" />
      </svg>
    ),
  },
];

function NavRow({ entry, id }: { entry: NavEntry; id: string }) {
  return (
    <Link
      to={entry.to}
      params={{ id }}
      className="nav-item"
      activeProps={{ className: 'active' }}
    >
      {entry.icon}
      {entry.label}
    </Link>
  );
}

function ProjectSection({ id }: { id: string }) {
  const { data: project } = useProject(id);
  return (
    <>
      <div className="proj">
        <span className="proj-dot" />
        <span className="proj-name">{project?.name ?? '…'}</span>
      </div>
      <div className="nav-label">Plan</div>
      {PLAN_NAV.map((entry) => (
        <NavRow key={entry.label} entry={entry} id={id} />
      ))}
      <div className="nav-label">Workspace</div>
      {WORKSPACE_NAV.map((entry) => (
        <NavRow key={entry.label} entry={entry} id={id} />
      ))}
    </>
  );
}

export function Sidebar() {
  const params = useParams({ strict: false });
  const id = params.id;

  return (
    <aside className="sidebar">
      <div className="ws">
        <div className="ws-badge">P</div>
        <span className="ws-name">Plan Desk</span>
        <svg
          className="ws-chev"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path d="M8 9l4 4 4-4M8 15l4-4 4 4" />
        </svg>
      </div>
      <div className="side-scroll">
        {id === undefined ? (
          <>
            <div className="nav-label">Workspace</div>
            <Link to="/" className="nav-item" activeProps={{ className: 'active' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              Projects
            </Link>
          </>
        ) : (
          <ProjectSection id={id} />
        )}
      </div>
      <div className="side-foot">
        {/* Command palette stub — non-functional in this slice. */}
        <button type="button" className="cmdk">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M20 20l-4-4" />
          </svg>
          Search or run a command
          <span style={{ marginLeft: 'auto' }}>
            <kbd>⌘</kbd> <kbd>K</kbd>
          </span>
        </button>
        <Link to="/settings/mcp" className="icon-btn" title="Settings" aria-label="Settings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 3v2.2M12 18.8V21M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M3 12h2.2M18.8 12H21M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}
