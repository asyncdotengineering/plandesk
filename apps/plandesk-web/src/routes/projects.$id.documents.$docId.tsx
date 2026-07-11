import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { toast } from 'sonner';
import { CommentsPanel } from '../components/docs/CommentsPanel.js';
import { DocumentEditor, type DocumentEditorMode } from '../components/docs/DocumentEditor.js';
import { flattenDocumentTree } from '../components/docs/DocumentsPanel.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCreateComment,
  useDeleteDocument,
  useDocument,
  useDocuments,
  usePatchDocument,
  useProject,
} from '../lib/queries.js';

function DocumentPage() {
  const { id, docId } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: document, isLoading: docLoading, error: docError } = useDocument(docId);
  const { data: allDocuments } = useDocuments(id);
  const patchDocument = usePatchDocument();
  const deleteDocument = useDeleteDocument();
  const createComment = useCreateComment({ type: 'document', id: docId });
  const [mode, setMode] = useState<DocumentEditorMode>('reader');
  // A brand-new / empty document opens in Edit so you can start writing; an
  // existing document opens read-first. Runs once when the doc first loads.
  const modeInitialized = useRef(false);
  useEffect(() => {
    if (!modeInitialized.current && document !== undefined) {
      modeInitialized.current = true;
      if ((document.body ?? '').replace(/<[^>]*>/g, '').trim() === '') {
        setMode('editor');
      }
    }
  }, [document]);

  // Searchable targets for the "[[" doc-link suggestion (excluding this doc).
  const docLinks = flattenDocumentTree(allDocuments ?? [])
    .filter((doc) => doc.id !== docId)
    .map((doc) => ({ id: doc.id, title: doc.title }));

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
            to="/projects/$id/documents"
            params={{ id }}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Documents
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
          key={docId}
          document={document}
          mode={mode}
          projectId={id}
          docLinks={docLinks}
          isSaving={patchDocument.isPending}
          isDeleting={deleteDocument.isPending}
          onCreateComment={async ({ passage, body }) => {
            await createComment.mutateAsync({ body, passage });
            toast('Comment added');
          }}
          onSave={(input) => patchDocument.mutateAsync({ id: docId, input }).then(() => undefined)}
          onDelete={() => {
            deleteDocument.mutate(
              { id: docId, projectId: id },
              {
                onSuccess: () => {
                  void navigate({ to: '/projects/$id/documents', params: { id } });
                },
              },
            );
          }}
        />
      </div>
      <CommentsPanel target={{ type: 'document', id: docId }} />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/documents/$docId')({
  component: DocumentPage,
});
