import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { CommentsPanel } from '../components/docs/CommentsPanel.js';
import { DocumentEditor, type DocumentEditorMode } from '../components/docs/DocumentEditor.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDeleteDocument, useDocument, usePatchDocument, useProject } from '../lib/queries.js';

function DocumentPage() {
  const { id, docId } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: document, isLoading: docLoading, error: docError } = useDocument(docId);
  const patchDocument = usePatchDocument();
  const deleteDocument = useDeleteDocument();
  const [mode, setMode] = useState<DocumentEditorMode>('reader');
  const [pendingPassage, setPendingPassage] = useState<string | null>(null);

  if (projectLoading || docLoading) {
    return <p className="text-sm text-muted-foreground">Loading document…</p>;
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
    <div className="flex h-[calc(100vh-6rem)] min-h-0 gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/projects/$id/overview"
            params={{ id }}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            {project.name}
          </Link>
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value as DocumentEditorMode);
            }}
          >
            <TabsList>
              <TabsTrigger value="reader">Reader</TabsTrigger>
              <TabsTrigger value="editor">Edit</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {patchDocument.error !== null ? (
          <p role="alert" className="text-[13px] text-destructive">
            Save failed: {patchDocument.error.message}
          </p>
        ) : null}

        <DocumentEditor
          document={document}
          mode={mode}
          isSaving={patchDocument.isPending}
          isDeleting={deleteDocument.isPending}
          onCommentOnSelection={(passage) => {
            setPendingPassage(passage);
          }}
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
      <CommentsPanel
        target={{ type: 'document', id: docId }}
        attachPassage={pendingPassage}
        onPassageConsumed={() => {
          setPendingPassage(null);
        }}
      />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/documents/$docId')({
  component: DocumentPage,
});
