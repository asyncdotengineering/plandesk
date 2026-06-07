import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries.js';

type TaskUpdatedEvent = {
  type: 'task_updated';
  taskId: string;
  projectId: string;
};

type CanvasUpdatedEvent = {
  type: 'canvas_updated';
  projectId: string;
};

type DocumentCreatedEvent = {
  type: 'document_created';
  documentId: string;
  projectId: string;
};

type AgentRunStartedEvent = {
  type: 'agent_run_started';
  runId: string;
  projectId: string;
};

type AgentRunProgressEvent = {
  type: 'agent_run_progress';
  runId: string;
  projectId: string;
};

type AgentRunCompletedEvent = {
  type: 'agent_run_completed';
  runId: string;
  projectId: string;
};

type PlankDeskEvent =
  | TaskUpdatedEvent
  | CanvasUpdatedEvent
  | DocumentCreatedEvent
  | AgentRunStartedEvent
  | AgentRunProgressEvent
  | AgentRunCompletedEvent;

function isPlankDeskEvent(value: unknown): value is PlankDeskEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = value.type;
  return (
    type === 'task_updated' ||
    type === 'canvas_updated' ||
    type === 'document_created' ||
    type === 'agent_run_started' ||
    type === 'agent_run_progress' ||
    type === 'agent_run_completed'
  );
}

export function useSseInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/v1/events');

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
      if (!isPlankDeskEvent(event)) {
        return;
      }

      switch (event.type) {
        case 'task_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.project(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.taskDocument(event.taskId) });
          break;
        case 'canvas_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(event.projectId) });
          break;
        case 'document_created':
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.document(event.documentId) });
          break;
        case 'agent_run_started':
        case 'agent_run_progress':
        case 'agent_run_completed':
          void queryClient.invalidateQueries({ queryKey: queryKeys.agentRuns(event.projectId) });
          break;
      }
    };

    return () => {
      source.close();
    };
  }, [queryClient]);
}
