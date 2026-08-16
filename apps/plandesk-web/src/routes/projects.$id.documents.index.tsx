import { createFileRoute } from '@tanstack/react-router';
import { DocumentsPanel } from '../components/docs/DocumentsPanel.js';
import { useDocuments, useFolders, useProject, useTasks } from '../lib/queries.js';

function ProjectDocumentsPage() {
  const { id } = Route.useParams();
  const { data: project, isLoading, error } = useProject(id);
  const {
    data: documents,
    isLoading: documentsLoading,
    isError: documentsError,
  } = useDocuments(id);
  const { data: folders, isLoading: foldersLoading, isError: foldersError } = useFolders(id);
  const { data: tasks } = useTasks(id);

  if (isLoading || documentsLoading || foldersLoading) {
    return <p className="text-sm text-muted-foreground">Loading documents…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load project: {error.message}
      </p>
    );
  }

  if (documentsError || foldersError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load documents
      </p>
    );
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <DocumentsPanel
        projectId={id}
        documents={documents ?? []}
        folders={folders ?? []}
        tasks={tasks ?? []}
      />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/documents/')({
  component: ProjectDocumentsPage,
});
