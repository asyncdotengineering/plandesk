import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { JoinGate } from './JoinGate.js';
import {
  PortalNotReadyError,
  PortalUnauthorizedError,
  clearPortalSession,
  fetchClientView,
  loadPortalSession,
  savePortalSession,
  type AnyClientView,
} from '@/lib/portal.js';

export function PortalShareGate({
  shareToken,
  children,
}: {
  shareToken: string;
  children: (
    view: Exclude<AnyClientView, { kind: 'workspace' }>,
    sessionToken: string,
  ) => ReactNode;
}) {
  const [session, setSession] = useState<string | null>(() => loadPortalSession(shareToken));
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', shareToken, session],
    queryFn: () => {
      if (session === null) throw new Error('Portal session is required');
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

  if (session === null || sessionInvalid) {
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
    return <p className="px-5 py-8 text-sm text-muted-foreground">{error.message}</p>;
  }
  if (error !== null) {
    return (
      <p role="alert" className="px-5 py-8 text-sm text-destructive">
        Failed to load shared project: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }
  if (data === undefined || 'kind' in data) {
    return <p className="px-5 py-8 text-sm text-muted-foreground">Shared project not found.</p>;
  }
  return <>{children(data, session)}</>;
}
