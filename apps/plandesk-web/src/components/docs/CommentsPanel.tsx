import { useState } from 'react';
import type { SerializedComment } from '../../lib/api.js';
import {
  useCreateComment,
  useDeleteComment,
  useDocumentComments,
  usePatchComment,
} from '../../lib/queries.js';

type CommentsPanelProps = {
  documentId: string;
  projectId: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function readSelection(): string | null {
  const text = window.getSelection()?.toString().trim() ?? '';
  return text === '' ? null : text;
}

function CommentItem({
  comment,
  onResolve,
  onDelete,
  isResolving,
  isDeleting,
}: {
  comment: SerializedComment;
  onResolve: () => void;
  onDelete: () => void;
  isResolving: boolean;
  isDeleting: boolean;
}) {
  return (
    <li
      style={{
        padding: '0.75rem',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: comment.resolved ? '#f9fafb' : '#fff',
      }}
    >
      {comment.passage !== null ? (
        <p
          style={{
            margin: '0 0 0.5rem',
            fontSize: '0.8125rem',
            color: '#6b7280',
            fontStyle: 'italic',
          }}
        >
          &ldquo;{comment.passage}&rdquo;
        </p>
      ) : null}
      <p style={{ margin: '0 0 0.5rem', lineHeight: 1.5 }}>{comment.body}</p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
          {formatDate(comment.created_at)}
          {comment.resolved ? ' · Resolved' : ''}
        </span>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button
            type="button"
            onClick={onResolve}
            disabled={isResolving || isDeleting}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: '0.8125rem',
              cursor: isResolving ? 'wait' : 'pointer',
            }}
          >
            {isResolving ? '…' : comment.resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isResolving || isDeleting}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: 4,
              border: '1px solid #fca5a5',
              background: '#fef2f2',
              color: '#b91c1c',
              fontSize: '0.8125rem',
              cursor: isDeleting ? 'wait' : 'pointer',
            }}
          >
            {isDeleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  );
}

export function CommentsPanel({ documentId }: CommentsPanelProps) {
  const { data: comments, isLoading, error } = useDocumentComments(documentId);
  const createComment = useCreateComment(documentId);
  const patchComment = usePatchComment(documentId);
  const deleteComment = useDeleteComment(documentId);

  const [body, setBody] = useState('');
  const [attachedPassage, setAttachedPassage] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const allComments = comments ?? [];
  const openComments = allComments.filter((c) => !c.resolved);
  const resolvedComments = allComments.filter((c) => c.resolved);

  const handleAttachSelection = () => {
    const selection = readSelection();
    if (selection !== null) {
      setAttachedPassage(selection);
    }
  };

  const handleSubmit = () => {
    const trimmed = body.trim();
    if (trimmed === '') {
      return;
    }
    const passage = attachedPassage ?? readSelection();
    createComment.mutate(passage !== null ? { body: trimmed, passage } : { body: trimmed }, {
      onSuccess: () => {
        setBody('');
        setAttachedPassage(null);
      },
    });
  };

  const handleResolve = (comment: SerializedComment) => {
    setPendingActionId(comment.id);
    patchComment.mutate(
      { id: comment.id, input: { resolved: !comment.resolved } },
      {
        onSettled: () => {
          setPendingActionId(null);
        },
      },
    );
  };

  const handleDelete = (comment: SerializedComment) => {
    if (!confirm('Delete this comment?')) {
      return;
    }
    setPendingActionId(comment.id);
    deleteComment.mutate(comment.id, {
      onSettled: () => {
        setPendingActionId(null);
      },
    });
  };

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid #e5e7eb',
        paddingLeft: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.125rem' }}>Comments</h2>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
          {openComments.length} open
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          padding: '0.75rem',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fafafa',
        }}
      >
        {attachedPassage !== null ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              padding: '0.5rem',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
            }}
          >
            <p
              style={{
                margin: 0,
                flex: 1,
                fontSize: '0.8125rem',
                color: '#6b7280',
                fontStyle: 'italic',
              }}
            >
              &ldquo;{attachedPassage}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => {
                setAttachedPassage(null);
              }}
              aria-label="Clear attached selection"
              style={{
                padding: '0.125rem 0.375rem',
                borderRadius: 4,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        ) : null}
        <textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          placeholder="Leave feedback for teammates or an agent…"
          rows={3}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            resize: 'vertical',
            fontFamily: 'inherit',
            fontSize: '0.875rem',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleAttachSelection}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            Attach selection
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={body.trim() === '' || createComment.isPending}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #1d4ed8',
              background: '#1d4ed8',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: createComment.isPending ? 'wait' : 'pointer',
            }}
          >
            {createComment.isPending ? 'Adding…' : 'Add comment'}
          </button>
        </div>
        {createComment.error !== null ? (
          <p role="alert" style={{ margin: 0, fontSize: '0.8125rem', color: '#b91c1c' }}>
            {createComment.error.message}
          </p>
        ) : null}
      </div>

      {isLoading ? <p style={{ margin: 0, color: '#6b7280' }}>Loading comments…</p> : null}
      {error !== null ? (
        <p role="alert" style={{ margin: 0, color: '#b91c1c' }}>
          Failed to load comments: {error.message}
        </p>
      ) : null}

      {!isLoading && error === null && allComments.length === 0 ? (
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
          No comments yet — add one to leave feedback for teammates or an agent.
        </p>
      ) : null}

      {!isLoading && error === null && openComments.length > 0 ? (
        <div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151' }}>Open</h3>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {openComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onResolve={() => {
                  handleResolve(comment);
                }}
                onDelete={() => {
                  handleDelete(comment);
                }}
                isResolving={patchComment.isPending && pendingActionId === comment.id}
                isDeleting={deleteComment.isPending && pendingActionId === comment.id}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {!isLoading && error === null && resolvedComments.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setShowResolved((value) => !value);
            }}
            style={{
              padding: '0.25rem 0',
              border: 'none',
              background: 'transparent',
              color: '#1d4ed8',
              fontSize: '0.875rem',
              cursor: 'pointer',
              marginBottom: showResolved ? '0.5rem' : 0,
            }}
          >
            {showResolved ? 'Hide resolved' : `Show resolved (${String(resolvedComments.length)})`}
          </button>
          {showResolved ? (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {resolvedComments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  onResolve={() => {
                    handleResolve(comment);
                  }}
                  onDelete={() => {
                    handleDelete(comment);
                  }}
                  isResolving={patchComment.isPending && pendingActionId === comment.id}
                  isDeleting={deleteComment.isPending && pendingActionId === comment.id}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
