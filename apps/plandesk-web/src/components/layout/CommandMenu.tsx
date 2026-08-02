import { useNavigate, useParams } from '@tanstack/react-router';
import {
  AppWindowIcon,
  CircleDotIcon,
  FileTextIcon,
  FolderKanbanIcon,
  GitBranchIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  ListIcon,
  SettingsIcon,
  StickyNoteIcon,
  TargetIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useProjects } from '../../lib/queries.js';

type CommandMenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <CommandMenuContext.Provider value={{ open, setOpen }}>{children}</CommandMenuContext.Provider>
  );
}

export function useCommandMenu() {
  const ctx = useContext(CommandMenuContext);
  if (ctx === null) {
    throw new Error('useCommandMenu must be used within CommandMenuProvider');
  }
  return ctx;
}

export const NAV_ITEMS = [
  { label: 'Overview', to: '/projects/$id/overview' as const, icon: LayoutDashboardIcon },
  { label: 'Board', to: '/projects/$id/board' as const, icon: LayoutGridIcon },
  { label: 'List', to: '/projects/$id/list' as const, icon: ListIcon },
  { label: 'Flow', to: '/projects/$id/flow' as const, icon: GitBranchIcon },
  { label: 'Goals', to: '/projects/$id/goals' as const, icon: TargetIcon },
  { label: 'Prototypes', to: '/projects/$id/prototypes' as const, icon: AppWindowIcon },
  { label: 'Documents', to: '/projects/$id/documents' as const, icon: FileTextIcon },
  { label: 'Notes', to: '/projects/$id/notes' as const, icon: StickyNoteIcon },
  { label: 'Inbox', to: '/projects/$id/inbox' as const, icon: InboxIcon },
] as const;

export function CommandMenu() {
  const { open, setOpen } = useCommandMenu();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const projectId = params.id;
  const { data: projects = [] } = useProjects();

  const go = useCallback(
    (to: string, navParams?: Record<string, string>) => {
      setOpen(false);
      void navigate({ to, params: navParams });
    },
    [navigate, setOpen],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [setOpen]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {projectId !== undefined ? (
          <CommandGroup heading="Navigate">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.label}
                value={item.label}
                onSelect={() => {
                  go(item.to, { id: projectId });
                }}
              >
                <item.icon />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {projectId !== undefined ? <CommandSeparator /> : null}

        <CommandGroup heading="Projects">
          <CommandItem
            value="All projects"
            onSelect={() => {
              go('/');
            }}
          >
            <FolderKanbanIcon />
            All projects
          </CommandItem>
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={project.name}
              onSelect={() => {
                go('/projects/$id/overview', { id: project.id });
              }}
            >
              <CircleDotIcon />
              {project.name}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Settings">
          <CommandItem
            value="Members"
            onSelect={() => {
              go('/settings/members');
            }}
          >
            <SettingsIcon />
            Members
          </CommandItem>
          <CommandItem
            value="MCP Settings"
            onSelect={() => {
              go('/settings/mcp');
            }}
          >
            <SettingsIcon />
            MCP Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}