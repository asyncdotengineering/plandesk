import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const SYNC_BASE = import.meta.env.VITE_SYNC_URL ?? '';

type ProjectionUpdatedEvent = {
  type: 'projection_updated';
};

function isProjectionUpdatedEvent(value: unknown): value is ProjectionUpdatedEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'projection_updated'
  );
}

export function usePortalLiveRefetch(
  shareToken: string,
  session: string | null,
  viewLoaded: boolean,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined' || session === null || !viewLoaded) {
      return;
    }

    const source = new EventSource(
      `${SYNC_BASE}/api/portal/v1/shares/${encodeURIComponent(shareToken)}/events`,
    );

    source.onmessage = (message) => {
      if (typeof message.data !== 'string') {
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!isProjectionUpdatedEvent(event)) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['portal', shareToken, session] });
    };

    return () => {
      source.close();
    };
  }, [queryClient, shareToken, session, viewLoaded]);
}
