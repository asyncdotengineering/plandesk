import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

export type ProjectView = 'board' | 'list' | 'flow';

const VIEWS: {
  id: ProjectView;
  label: string;
  to: '/projects/$id/board' | '/projects/$id/list' | '/projects/$id/flow';
}[] = [
  { id: 'board', label: 'Board', to: '/projects/$id/board' },
  { id: 'list', label: 'List', to: '/projects/$id/list' },
  { id: 'flow', label: 'Canvas', to: '/projects/$id/flow' },
];

export function ViewSwitcher({ projectId, active }: { projectId: string; active: ProjectView }) {
  return (
    <nav
      aria-label="Project view"
      className="mb-3 inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
      data-view-switcher
    >
      {VIEWS.map((view) => (
        <Link
          key={view.id}
          to={view.to}
          params={{ id: projectId }}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            active === view.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          data-view={view.id}
          aria-current={active === view.id ? 'page' : undefined}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
