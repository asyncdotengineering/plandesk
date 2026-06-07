export type TaskUpdatedEvent = {
  type: 'task_updated';
  taskId: string;
  projectId: string;
};

export type CanvasUpdatedEvent = {
  type: 'canvas_updated';
  projectId: string;
};

export type DocumentCreatedEvent = {
  type: 'document_created';
  documentId: string;
  projectId: string;
};

export type AgentRunStartedEvent = {
  type: 'agent_run_started';
  runId: string;
  projectId: string;
};

export type AgentRunProgressEvent = {
  type: 'agent_run_progress';
  runId: string;
  projectId: string;
};

export type AgentRunCompletedEvent = {
  type: 'agent_run_completed';
  runId: string;
  projectId: string;
};

export type PlankDeskEvent =
  | TaskUpdatedEvent
  | CanvasUpdatedEvent
  | DocumentCreatedEvent
  | AgentRunStartedEvent
  | AgentRunProgressEvent
  | AgentRunCompletedEvent;

export type EventListener = (event: PlankDeskEvent) => void;

export type EventBus = {
  subscribe(listener: EventListener): () => void;
  emit(event: PlankDeskEvent): void;
  subscriberCount(): number;
};

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();

  return {
    subscribe(listener: EventListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    emit(event: PlankDeskEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },

    subscriberCount() {
      return listeners.size;
    },
  };
}
