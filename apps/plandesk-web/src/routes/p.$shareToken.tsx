import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { JoinGate } from '../components/portal/JoinGate.js';
import { PortalPage } from '../components/portal/PortalPage.js';
import {
  PortalNotReadyError,
  PortalUnauthorizedError,
  clearPortalSession,
  fetchClientView,
  loadPortalSession,
  savePortalSession,
} from '../lib/portal.js';

function PortalRoutePage() {
  const { shareToken } = Route.useParams();
  const [session, setSession] = useState<string | null>(() => loadPortalSession(shareToken));

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', shareToken, session],
    queryFn: () => {
      if (session === null) {
        throw new Error('Portal session is required');
      }
      return fetchClientView(shareToken, session);
    },
    enabled: session !== null,
    retry: false,
  });

  const sessionInvalid = error instanceof PortalUnauthorizedError;

  useEffect(() => {
    if (sessionInvalid) {
      clearPortalSession(shareToken);
      setSession(null);
    }
  }, [sessionInvalid, shareToken]);

  if (!session || sessionInvalid) {
    return (
      <JoinGate
        shareToken={shareToken}
        onJoined={(token) => {
          savePortalSession(shareToken, token);
          setSession(token);
        }}
      />
    );
  }

  if (isLoading) {
    return <p>Loading shared project…</p>;
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
