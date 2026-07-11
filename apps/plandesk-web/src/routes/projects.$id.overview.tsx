import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { taskStatuses } from '../lib/api.js';
import { DocumentsPanel } from '../components/docs/DocumentsPanel.js';
import { ConfirmDialog } from '../components/docs/ConfirmDialog.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useDeleteProject,
  useDocuments,
  useFolders,
  usePatchProject,
  useProject,
  useTasks,
} from '../lib/queries.js';

const STATUS_LABELS: Record<string, string> = {
  scope: 'Scope',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  backlog: 'Backlog',
};

function ProjectOverviewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading, error } = useProject(id);
  const { data: tasks } = useTasks(id);
  const { data: documents } = useDocuments(id);
  const { data: folders } = useFolders(id);
  const patchProject = usePatchProject();
  const deleteProject = useDeleteProject();
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (project !== undefined) {
      setName(project.name);
    }
  }, [project?.name, project]);

  const commitName = () => {
    const trimmed = name.trim();
    if (project === undefined || trimmed === '' || trimmed === project.name) {
      setName(project?.name ?? '');
      setEditingName(false);
      return;
    }
    patchProject.mutate(
      { id, input: { name: trimmed } },
      {
        onSuccess: () => {
          setEditingName(false);
        },
      },
    );
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }

  if (error) {
    return <p role="alert">Failed to load project: {error.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          {editingName ? (
            <Input
              type="text"
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
              }}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitName();
                }
                if (event.key === 'Escape') {
                  setName(project.name);
                  setEditingName(false);
                }
              }}
              aria-label="Project name"
              className="h-auto max-w-md flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight shadow-none focus-visible:border-ring focus-visible:ring-0"
            />
          ) : (
            <div className="group flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Rename project"
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  setEditingName(true);
                }}
              >
                <PencilIcon className="size-3.5" />
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            disabled={deleteProject.isPending}
            onClick={() => {
              setConfirmDeleteOpen(true);
            }}
          >
            Delete project
          </Button>
        </div>
        {project.description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{project.description}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {taskStatuses.map((status) => (
            <span
              key={status}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[12px]"
            >
              <span className="text-muted-foreground">{STATUS_LABELS[status] ?? status}</span>
              <span className="font-semibold tabular-nums">{project.summary[status]}</span>
            </span>
          ))}
        </div>
      </header>

      <DocumentsPanel
        projectId={id}
        documents={documents ?? []}
        folders={folders ?? []}
        tasks={tasks ?? []}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete "${project.name}"?`}
        description="This deletes the project and all its tasks, documents, and edges. This cannot be undone."
        confirmLabel="Delete project"
        busy={deleteProject.isPending}
        onConfirm={() => {
          deleteProject.mutate(id, {
            onSuccess: () => {
              setConfirmDeleteOpen(false);
              void navigate({ to: '/' });
            },
          });
        }}
      />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/overview')({
  component: ProjectOverviewPage,
});
