import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { JoinGate } from '../components/portal/JoinGate.js';
import { PortalPage } from '../components/portal/PortalPage.js';
import { usePortalLiveRefetch } from '../lib/portal-events.js';
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
  const viewLoaded =
    session !== null &&
    !sessionInvalid &&
    !isLoading &&
    data !== undefined &&
    !(error instanceof PortalNotReadyError);

  usePortalLiveRefetch(shareToken, session, viewLoaded);

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
    return <p className="px-5 py-8 text-sm text-muted-foreground">Loading shared project…</p>;
  }

  if (error instanceof PortalNotReadyError) {
    return (
      <section role="status" className="mx-auto max-w-lg px-5 py-8">
        <h1 className="mb-2 text-xl font-semibold">Not published yet</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </section>
    );
  }

  if (error) {
    return (
      <p role="alert" className="px-5 py-8 text-sm text-destructive">
        Failed to load shared project: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }

  if (data === undefined) {
    return <p className="px-5 py-8 text-sm text-muted-foreground">Shared project not found.</p>;
  }

  return (
    <PortalPage
      view={data}
      shareToken={shareToken}
      sessionToken={session}
      onUnauthorized={() => {
        clearPortalSession(shareToken);
        setSession(null);
      }}
    />
  );
}

export const Route = createFileRoute('/p/$shareToken')({
  component: PortalRoutePage,
});
