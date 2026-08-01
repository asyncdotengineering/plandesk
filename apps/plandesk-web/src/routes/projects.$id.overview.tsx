import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ArrowRightIcon, FileTextIcon, PencilIcon } from 'lucide-react';
import { taskStatuses } from '../lib/api.js';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { flattenDocumentTree } from '../components/docs/DocumentsPanel.js';
import { ConfirmDialog } from '../components/docs/ConfirmDialog.js';
import { AcceptanceIndicator, GoalStatusBadge } from '../components/goals/goal-ui.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useDeleteProject,
  useDocuments,
  useGoals,
  usePatchProject,
  useProject,
} from '../lib/queries.js';

const STATUS_META: { status: (typeof taskStatuses)[number]; label: string; dot: string }[] = [
  { status: 'scope', label: 'Scope', dot: 'var(--s-scope-dot)' },
  { status: 'todo', label: 'To do', dot: 'var(--s-todo-dot)' },
  { status: 'in_progress', label: 'In progress', dot: 'var(--s-prog-dot)' },
  { status: 'done', label: 'Done', dot: 'var(--s-done-dot)' },
  { status: 'backlog', label: 'Backlog', dot: 'var(--s-back-dot)' },
];

function ProjectOverviewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading, error } = useProject(id);
  const {
    data: goals,
    isLoading: goalsLoading,
    isError: goalsError,
  } = useGoals(id);
  const {
    data: documents,
    isLoading: documentsLoading,
    isError: documentsError,
  } = useDocuments(id);
  const patchProject = usePatchProject();
  const deleteProject = useDeleteProject();
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (project !== undefined) {
      setName(project.name);
      setOwnerId(project.owner_id ?? '');
    }
  }, [project?.name, project?.owner_id, project]);

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

  const commitOwner = () => {
    if (project === undefined) {
      return;
    }
    const next = ownerId.trim() === '' ? null : ownerId.trim();
    if (next === project.owner_id) {
      setEditingOwner(false);
      return;
    }
    patchProject.mutate(
      { id, input: { owner_id: next } },
      {
        onSuccess: () => {
          setEditingOwner(false);
        },
      },
    );
  };

  const setOverviewDocument = (documentId: string | null) => {
    if (project === undefined) {
      return;
    }
    if (documentId === project.overview_document_id) {
      return;
    }
    patchProject.mutate({ id, input: { overview_document_id: documentId } });
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

  const total = taskStatuses.reduce((sum, status) => sum + project.summary[status], 0);
  const donePct = total === 0 ? 0 : Math.round((project.summary.done / total) * 100);

  const goalList = goals ?? [];
  const activeGoals = [...goalList]
    .sort((a, b) => (a.status === 'complete' ? 1 : 0) - (b.status === 'complete' ? 1 : 0))
    .slice(0, 5);

  const flatDocs = flattenDocumentTree(documents ?? []);
  const recentDocs = [...flatDocs]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);
  const overviewDoc = flatDocs.find((doc) => doc.id === project.overview_document_id);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <header>
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
                className="opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{project.description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground">Owner</span>
            {editingOwner ? (
              <Input
                type="text"
                value={ownerId}
                autoFocus
                onChange={(event) => {
                  setOwnerId(event.target.value);
                }}
                onBlur={commitOwner}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitOwner();
                  }
                  if (event.key === 'Escape') {
                    setOwnerId(project.owner_id ?? '');
                    setEditingOwner(false);
                  }
                }}
                aria-label="Project owner"
                placeholder="Unassigned"
                className="h-8 w-48"
              />
            ) : (
              <button
                type="button"
                className="text-foreground hover:underline"
                onClick={() => {
                  setEditingOwner(true);
                }}
              >
                {project.owner_id ?? 'Unassigned'}
              </button>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground">Overview</span>
            <select
              aria-label="Overview document"
              className="h-8 max-w-xs rounded-md border bg-background px-2 text-sm"
              value={project.overview_document_id ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setOverviewDocument(value === '' ? null : value);
              }}
            >
              <option value="">None</option>
              {flatDocs.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>
            {overviewDoc !== undefined ? (
              <Link
                to="/projects/$id/documents/$docId"
                params={{ id, docId: overviewDoc.id }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                Open <ArrowRightIcon className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* Status at a glance */}
      <section aria-label="Task status" className="rounded-xl border bg-card p-4 shadow-[var(--shadow)]">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Progress</h2>
          <Link
            to="/projects/$id/board"
            params={{ id }}
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Open board <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
        <div className="mb-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--s-done-dot)] transition-[width]"
              style={{ width: `${String(donePct)}%` }}
            />
          </div>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {project.summary.done}/{total} done
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STATUS_META.map((meta) => (
            <div key={meta.status} className="rounded-lg border bg-background px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: meta.dot }}
                />
                <span className="truncate text-[11.5px] text-muted-foreground">{meta.label}</span>
              </div>
              <div className="mt-0.5 text-xl font-semibold tabular-nums">
                {project.summary[meta.status]}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Goals + Agent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section
          aria-label="Goals"
          className="flex flex-col rounded-xl border bg-card p-4 shadow-[var(--shadow)]"
        >
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Goals</h2>
            <Link
              to="/projects/$id/goals"
              params={{ id }}
              className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
            >
              All goals <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
          {goalsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : goalsError ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t load goals
            </p>
          ) : activeGoals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goals yet.</p>
          ) : (
            <ul className="m-0 flex flex-col gap-2 p-0">
              {activeGoals.map((goal) => (
                <li key={goal.id}>
                  <Link
                    to="/projects/$id/goals"
                    params={{ id }}
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors hover:bg-accent"
                  >
                    <AcceptanceIndicator verification={goal.last_verification} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{goal.objective}</span>
                    <GoalStatusBadge status={goal.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Agent activity" className="min-h-0">
          <div className="relative h-[360px]">
            <AgentRunsPanel projectId={id} />
          </div>
        </section>
      </div>

      {/* Recent documents */}
      <section aria-label="Recent documents">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Recent documents</h2>
          <Link
            to="/projects/$id/documents"
            params={{ id }}
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            All documents <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
        {documentsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : documentsError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t load documents
          </p>
        ) : recentDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recentDocs.map((doc) => (
              <Link
                key={doc.id}
                to="/projects/$id/documents/$docId"
                params={{ id, docId: doc.id }}
                className="group flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:border-[var(--border-strong)] hover:bg-accent"
              >
                <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2 text-[13px] font-medium leading-snug">
                  {doc.title}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

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
