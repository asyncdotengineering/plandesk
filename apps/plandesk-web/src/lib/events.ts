import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommentTargetType } from './api.js';
import { queryKeys } from './queries.js';

type TaskUpdatedEvent = {
  type: 'task_updated';
  taskId: string;
  projectId: string;
};

type TagUpdatedEvent = {
  type: 'tag_updated';
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

type CommentCreatedEvent = {
  type: 'comment_created';
  commentId: string;
  projectId: string;
  documentId?: string;
  target_type?: CommentTargetType;
  target_id?: string;
};

type CommentUpdatedEvent = {
  type: 'comment_updated';
  commentId: string;
  projectId: string;
  documentId?: string;
  target_type?: CommentTargetType;
  target_id?: string;
};

function commentTargetFromEvent(
  event: CommentCreatedEvent | CommentUpdatedEvent,
): { type: CommentTargetType; id: string } | null {
  if (event.target_type !== undefined && event.target_id !== undefined) {
    return { type: event.target_type, id: event.target_id };
  }
  if (event.documentId !== undefined) {
    return { type: 'document', id: event.documentId };
  }
  return null;
}

type FolderCreatedEvent = {
  type: 'folder_created';
  folderId: string;
  projectId: string;
};

type FolderUpdatedEvent = {
  type: 'folder_updated';
  folderId: string;
  projectId: string;
};

type NoteCreatedEvent = {
  type: 'note_created';
  noteId: string;
  projectId: string;
};

type NoteUpdatedEvent = {
  type: 'note_updated';
  noteId: string;
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

type GoalUpdatedEvent = {
  type: 'goal_updated';
  goalId: string;
  projectId: string;
};

type PlankDeskEvent =
  | TaskUpdatedEvent
  | TagUpdatedEvent
  | CanvasUpdatedEvent
  | DocumentCreatedEvent
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | FolderCreatedEvent
  | FolderUpdatedEvent
  | NoteCreatedEvent
  | NoteUpdatedEvent
  | AgentRunStartedEvent
  | AgentRunProgressEvent
  | AgentRunCompletedEvent
  | GoalUpdatedEvent;

function isPlankDeskEvent(value: unknown): value is PlankDeskEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = value.type;
  return (
    type === 'task_updated' ||
    type === 'tag_updated' ||
    type === 'canvas_updated' ||
    type === 'document_created' ||
    type === 'comment_created' ||
    type === 'comment_updated' ||
    type === 'folder_created' ||
    type === 'folder_updated' ||
    type === 'note_created' ||
    type === 'note_updated' ||
    type === 'agent_run_started' ||
    type === 'agent_run_progress' ||
    type === 'agent_run_completed' ||
    type === 'goal_updated'
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
          // task mutations can auto-create tags by name
          void queryClient.invalidateQueries({ queryKey: queryKeys.tags(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.taskDocument(event.taskId) });
          break;
        case 'tag_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.tags(event.projectId) });
          // renames/deletes change the tag chips embedded in task payloads
          void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(event.projectId) });
          break;
        case 'canvas_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(event.projectId) });
          break;
        case 'document_created':
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.document(event.documentId) });
          break;
        case 'comment_created':
        case 'comment_updated': {
          const target = commentTargetFromEvent(event);
          if (target !== null) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.comments(target.type, target.id),
            });
          }
          break;
        }
        case 'folder_created':
        case 'folder_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.folders(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents(event.projectId) });
          break;
        case 'note_created':
        case 'note_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.notes(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.note(event.noteId) });
          break;
        case 'agent_run_started':
        case 'agent_run_progress':
        case 'agent_run_completed':
          void queryClient.invalidateQueries({ queryKey: queryKeys.agentRuns(event.projectId) });
          break;
        case 'goal_updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.goals(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.goal(event.goalId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(event.projectId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(event.projectId) });
          break;
      }
    };

    return () => {
      source.close();
    };
  }, [queryClient]);
}
