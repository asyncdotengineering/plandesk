import { useNavigate, useParams } from '@tanstack/react-router';
import {
  AppWindowIcon,
  CheckSquareIcon,
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
import { searchWorkspace, type SearchResults } from '../../lib/api.js';
import { useActiveWorkspace } from '../../lib/auth.js';
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
  const activeWorkspaceId = useActiveWorkspace()?.id;
  const { data: projects = [] } = useProjects();
  const [query, setQuery] = useState('');
  const [contentResults, setContentResults] = useState<SearchResults | null>(null);

  const go = useCallback(
    (to: string, navParams?: Record<string, string>) => {
      setOpen(false);
      setQuery('');
      setContentResults(null);
      void navigate({ to, params: navParams });
    },
    [navigate, setOpen],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '' || activeWorkspaceId === undefined) {
      setContentResults(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void searchWorkspace(trimmed, {
        workspaceId: activeWorkspaceId,
        ...(projectId !== undefined ? { projectId } : {}),
        limit: 20,
      })
        .then(setContentResults)
        .catch(() => {
          setContentResults({ documents: [], tasks: [], notes: [] });
        });
    }, 200);
    return () => {
      window.clearTimeout(handle);
    };
  }, [activeWorkspaceId, projectId, query]);

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

  const hasContentResults =
    contentResults !== null &&
    (contentResults.documents.length > 0 ||
      contentResults.tasks.length > 0 ||
      contentResults.notes.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery('');
          setContentResults(null);
        }
      }}
    >
      <CommandInput
        placeholder="Search or run a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {hasContentResults ? (
          <>
            {contentResults.tasks.length > 0 ? (
              <CommandGroup heading="Tasks">
                {contentResults.tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={`task ${task.label}`}
                    onSelect={() => {
                      go('/projects/$id/board', { id: task.project_id });
                    }}
                  >
                    <CheckSquareIcon />
                    {task.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {contentResults.documents.length > 0 ? (
              <CommandGroup heading="Documents">
                {contentResults.documents.map((document) => (
                  <CommandItem
                    key={document.id}
                    value={`document ${document.title}`}
                    onSelect={() => {
                      go('/projects/$id/documents/$docId', {
                        id: document.project_id,
                        docId: document.id,
                      });
                    }}
                  >
                    <FileTextIcon />
                    {document.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {contentResults.notes.length > 0 ? (
              <CommandGroup heading="Notes">
                {contentResults.notes.map((note) => (
                  <CommandItem
                    key={note.id}
                    value={`note ${note.title}`}
                    onSelect={() => {
                      go('/projects/$id/notes/$noteId', {
                        id: note.project_id,
                        noteId: note.id,
                      });
                    }}
                  >
                    <StickyNoteIcon />
                    {note.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
          </>
        ) : null}

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
              go('/projects');
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
