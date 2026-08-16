import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { CommentsPanel } from '../components/docs/CommentsPanel.js';
import { ArtifactView } from '../components/docs/ArtifactView.js';
import { useArtifact, useProject } from '../lib/queries.js';

/**
 * A filed artifact, opened from the document tree.
 *
 * An HTML artifact renders in its sandboxed frame rather than the rich-text
 * reader: routing it through the document path would strip the styles and
 * scripts that make it a report. Comments sit beside it, so a filed report can
 * be reviewed where it lives.
 */
function ArtifactPage() {
  const { id, artifactId } = Route.useParams();
  const { data: project } = useProject(id);
  const { data: artifact, isLoading, error } = useArtifact(artifactId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load artifact: {error.message}
      </p>
    );
  }

  if (artifact === undefined) {
    return <p>Artifact not found.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/projects/$id/documents"
          params={{ id }}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {project?.name ?? 'Documents'}
        </Link>
      </div>

      <h1 className="mb-3 text-xl font-semibold">{artifact.title}</h1>

      <ArtifactView
        artifact={{
          id: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          folder_id: artifact.folder_id,
          prototype_id: artifact.prototype_id,
          revision_id: artifact.revision_id,
          updated_at: artifact.updated_at,
        }}
        body={artifact.content}
      />

      <div className="mt-6">
        <CommentsPanel target={{ type: 'artifact', id: artifact.id, projectId: id }} embedded />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/artifacts/$artifactId')({
  component: ArtifactPage,
});
