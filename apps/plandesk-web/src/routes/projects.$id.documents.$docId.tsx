import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { CommentsPanel } from '../components/docs/CommentsPanel.js';
import { DocumentEditor, type DocumentEditorMode } from '../components/docs/DocumentEditor.js';
import { useDeleteDocument, useDocument, usePatchDocument, useProject } from '../lib/queries.js';

function DocumentPage() {
  const { id, docId } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: document, isLoading: docLoading, error: docError } = useDocument(docId);
  const patchDocument = usePatchDocument();
  const deleteDocument = useDeleteDocument();
  const [mode, setMode] = useState<DocumentEditorMode>('editor');

  if (projectLoading || docLoading) {
    return <p>Loading document…</p>;
  }

  if (projectError !== null) {
    return <p role="alert">Failed to load project: {projectError.message}</p>;
  }

  if (docError !== null) {
    return <p role="alert">Failed to load document: {docError.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  if (document === undefined) {
    return <p>Document not found.</p>;
  }

  if (document.project_id !== id) {
    return <p role="alert">Document does not belong to this project.</p>;
  }

  return (
    <section>
      <p>
        <Link to="/projects/$id/overview" params={{ id }} style={{ color: '#555' }}>
          ← {project.name}
        </Link>
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => {
            setMode('reader');
          }}
          aria-pressed={mode === 'reader'}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: mode === 'reader' ? '#e5e7eb' : '#fff',
            fontWeight: mode === 'reader' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Reader
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('editor');
          }}
          aria-pressed={mode === 'editor'}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: mode === 'editor' ? '#e5e7eb' : '#fff',
            fontWeight: mode === 'editor' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Editor
        </button>
      </div>
      {patchDocument.error !== null ? (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Save failed: {patchDocument.error.message}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <DocumentEditor
            document={document}
            mode={mode}
            isSaving={patchDocument.isPending}
            isDeleting={deleteDocument.isPending}
            onSave={(input) => {
              patchDocument.mutate({ id: docId, input });
            }}
            onDelete={() => {
              deleteDocument.mutate(
                { id: docId, projectId: id },
                {
                  onSuccess: () => {
                    void navigate({ to: '/projects/$id/overview', params: { id } });
                  },
                },
              );
            }}
          />
        </div>
        <CommentsPanel documentId={docId} projectId={id} />
      </div>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/documents/$docId')({
  component: DocumentPage,
});
