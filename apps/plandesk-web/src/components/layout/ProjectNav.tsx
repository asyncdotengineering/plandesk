import { Link } from '@tanstack/react-router';

export function ProjectNav({ projectId }: { projectId: string }) {
  const tabs = [
    { label: 'Overview', to: '/projects/$id/overview' as const },
    { label: 'Flow', to: '/projects/$id/flow' as const },
    { label: 'Board', to: '/projects/$id/board' as const },
    { label: 'Goals', to: '/projects/$id/goals' as const },
    { label: 'Notes', to: '/projects/$id/notes' as const },
    { label: 'Inbox', to: '/projects/$id/inbox' as const },
  ];

  return (
    <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ id: projectId }}
          style={{ color: '#555', textDecoration: 'none' }}
          activeProps={{ style: { color: '#1a56db', fontWeight: 600 } }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
