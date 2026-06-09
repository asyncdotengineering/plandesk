import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PortalPage } from '../components/portal/PortalPage.js';
import { PortalNotReadyError, PortalUnauthorizedError, fetchClientView } from '../lib/portal.js';

function PortalRoutePage() {
  const { shareToken } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', shareToken],
    queryFn: () => fetchClientView(shareToken),
    retry: false,
  });

  if (isLoading) {
    return <p>Loading shared project…</p>;
  }

  if (error instanceof PortalUnauthorizedError) {
    return (
      <section role="alert">
        <h1 style={{ fontSize: '1.25rem', marginTop: 0 }}>Link unavailable</h1>
        <p>{error.message}</p>
      </section>
    );
  }

  if (error instanceof PortalNotReadyError) {
    return (
      <section role="status">
        <h1 style={{ fontSize: '1.25rem', marginTop: 0 }}>Not published yet</h1>
        <p>{error.message}</p>
      </section>
    );
  }

  if (error) {
    return (
      <p role="alert">
        Failed to load shared project: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }

  if (data === undefined) {
    return <p>Shared project not found.</p>;
  }

  return <PortalPage view={data} />;
}

export const Route = createFileRoute('/p/$shareToken')({
  component: PortalRoutePage,
});
