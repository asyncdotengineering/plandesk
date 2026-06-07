import { Link } from '@tanstack/react-router';

type OpenDocLinkProps = {
  projectId: string;
  documentId: string;
};

export function OpenDocLink({ projectId, documentId }: OpenDocLinkProps) {
  return (
    <Link
      to="/projects/$id/documents/$docId"
      params={{ id: projectId, docId: documentId }}
      style={{
        fontSize: '0.75rem',
        fontWeight: 600,
        color: '#1d4ed8',
        textDecoration: 'none',
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      Open doc →
    </Link>
  );
}
