import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { taskStatuses } from '../lib/api.js';
import { DocumentsPanel } from '../components/docs/DocumentsPanel.js';
import { ProjectNav } from '../components/layout/ProjectNav.js';
import {
  useCreateDocument,
  useDeleteProject,
  useDocuments,
  useFolders,
  usePatchProject,
  useProject,
  useTasks,
} from '../lib/queries.js';

function ProjectOverviewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading, error } = useProject(id);
  const { data: tasks } = useTasks(id);
  const { data: documents } = useDocuments(id);
  const { data: folders } = useFolders(id);
  const patchProject = usePatchProject();
  const deleteProject = useDeleteProject();
  const createDocument = useCreateDocument(id);
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);

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

  const handleDeleteProject = () => {
    if (!confirm('Delete this project and all its tasks, documents, and edges?')) {
      return;
    }
    deleteProject.mutate(id, {
      onSuccess: () => {
        void navigate({ to: '/' });
      },
    });
  };

  const handleNewDocument = () => {
    const title = prompt('Document title');
    if (title === null) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed === '') {
      return;
    }

    let linkedTaskId: string | null = null;
    if (tasks !== undefined && tasks.length > 0) {
      const taskChoice = prompt(
        `Link to a task? Enter task number (1-${String(tasks.length)}) or leave blank:\n${tasks.map((t, i) => `${String(i + 1)}. ${t.label}`).join('\n')}`,
      );
      if (taskChoice !== null && taskChoice.trim() !== '') {
        const index = Number.parseInt(taskChoice.trim(), 10) - 1;
        if (index >= 0 && index < tasks.length) {
          linkedTaskId = tasks[index]?.id ?? null;
        }
      }
    }

    createDocument.mutate(
      { title: trimmed, linked_task_id: linkedTaskId },
      {
        onSuccess: (doc) => {
          void navigate({
            to: '/projects/$id/documents/$docId',
            params: { id, docId: doc.id },
          });
        },
      },
    );
  };

  if (isLoading) {
    return <p>Loading project…</p>;
  }

  if (error) {
    return <p role="alert">Failed to load project: {error.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <section>
      <ProjectNav projectId={id} />
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}
      >
        {editingName ? (
          <input
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
            style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              border: '1px solid #93c5fd',
              borderRadius: 4,
              padding: '0.125rem 0.375rem',
              flex: 1,
            }}
          />
        ) : (
          <h1 style={{ margin: 0, flex: 1 }}>
            <button
              type="button"
              onClick={() => {
                setEditingName(true);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                cursor: 'text',
                color: 'inherit',
              }}
            >
              {project.name}
            </button>
          </h1>
        )}
        <button
          type="button"
          onClick={handleDeleteProject}
          disabled={deleteProject.isPending}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: deleteProject.isPending ? 'wait' : 'pointer',
          }}
        >
          Delete project
        </button>
      </div>
      {project.description ? <p style={{ color: '#666' }}>{project.description}</p> : null}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={handleNewDocument}
          disabled={createDocument.isPending}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 6,
            border: '1px solid #1d4ed8',
            background: '#1d4ed8',
            color: '#fff',
            fontWeight: 600,
            cursor: createDocument.isPending ? 'wait' : 'pointer',
          }}
        >
          {createDocument.isPending ? 'Creating…' : 'New document'}
        </button>
      </div>

      <DocumentsPanel
        projectId={id}
        documents={documents ?? []}
        folders={folders ?? []}
        onOpenDocument={(docId) => {
          void navigate({ to: '/projects/$id/documents/$docId', params: { id, docId } });
        }}
      />

      <h2 style={{ fontSize: '1rem' }}>Task status summary</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
        {taskStatuses.map((status) => (
          <li
            key={status}
            style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '16rem' }}
          >
            <span>{status.replace('_', ' ')}</span>
            <strong>{project.summary[status]}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/overview')({
  component: ProjectOverviewPage,
});
