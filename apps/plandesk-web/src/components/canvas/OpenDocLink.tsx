import { Link } from '@tanstack/react-router';
import { FileTextIcon } from 'lucide-react';

type OpenDocLinkProps = {
  projectId: string;
  documentId: string;
};

export function OpenDocLink({ projectId, documentId }: OpenDocLinkProps) {
  return (
    <Link
      to="/projects/$id/documents/$docId"
      params={{ id: projectId, docId: documentId }}
      aria-label="Open doc"
      className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-2)] hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <FileTextIcon className="size-[13px]" />
      Doc
    </Link>
  );
}
