import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useCreateProject, useProjects } from '../lib/queries.js';

export function ProjectListPage() {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const [name, setName] = useState('');

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    createProject.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName('');
        },
      },
    );
  }

  if (isLoading) {
    return <p>Loading projects…</p>;
  }

  if (error) {
    return <p role="alert">Failed to load projects: {error.message}</p>;
  }

  return (
    <section>
      <h1 style={{ marginTop: 0 }}>Projects</h1>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}
      >
        <input
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="New project name"
          aria-label="Project name"
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button type="submit" disabled={createProject.isPending || name.trim() === ''}>
          {createProject.isPending ? 'Creating…' : 'Create project'}
        </button>
      </form>

      {createProject.isError ? (
        <p role="alert" style={{ color: '#b00020' }}>
          Failed to create project: {createProject.error.message}
        </p>
      ) : null}

      {projects !== undefined && projects.length === 0 ? (
        <p>No projects yet. Create one above.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {projects?.map((project) => (
            <li
              key={project.id}
              style={{
                padding: '0.75rem 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <Link
                to="/projects/$id/overview"
                params={{ id: project.id }}
                style={{ fontWeight: 500, color: '#1a56db', textDecoration: 'none' }}
              >
                {project.name}
              </Link>
              {project.description ? (
                <p style={{ margin: '0.25rem 0 0', color: '#666' }}>{project.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const Route = createFileRoute('/')({
  component: ProjectListPage,
});
