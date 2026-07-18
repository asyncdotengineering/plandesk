import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, PaperclipIcon, Trash2Icon, UserIcon } from 'lucide-react';
import type { CommentTarget, SerializedComment } from '../../lib/api.js';
import { bodyToHtml } from '../../lib/markdown.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  usePatchComment,
} from '../../lib/queries.js';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';
import { ConfirmDialog } from './ConfirmDialog.js';

// Empty if there's no text and no embedded media (an image alone is content).
export function commentHasContent(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text !== '' || html.includes('<img');
}

type CommentsPanelProps = {
  target: CommentTarget;
  // A passage handed in from the on-selection "Add comment" affordance:
  // when set, it pre-attaches to the composer and focuses it. The parent clears it
  // via onPassageConsumed so the same text can be selected again.
  attachPassage?: string | null;
  onPassageConsumed?: () => void;
  embedded?: boolean;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function readSelection(): string | null {
  const text = window.getSelection()?.toString().trim() ?? '';
  return text === '' ? null : text;
}

type CommentItemProps = {
  comment: SerializedComment;
  onResolve: () => void;
  onDeleteRequest: () => void;
  isResolving: boolean;
  isDeleting: boolean;
};

function CommentItem({
  comment,
  onResolve,
  onDeleteRequest,
  isResolving,
  isDeleting,
}: CommentItemProps) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border p-2.5',
        comment.resolved ? 'border-border bg-muted/40' : 'border-border bg-card',
      )}
    >
      <Avatar className="mt-0.5 size-5">
        <AvatarFallback className="rounded-md">
          <UserIcon className="size-3" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        {comment.passage !== null ? (
          <p className="mb-1 text-[12px] italic text-muted-foreground">&ldquo;{comment.passage}&rdquo;</p>
        ) : null}
        <div
          className="comment-body text-[12.5px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_li]:list-disc [&_ol]:my-1 [&_ol]:pl-4 [&_p]:my-0 [&_p+p]:mt-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:my-1 [&_ul]:pl-4"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyToHtml(comment.body)) }}
        />
        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {formatDate(comment.created_at)}
            {comment.resolved ? ' · Resolved' : ''}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isResolving || isDeleting}
              onClick={onResolve}
            >
              {isResolving ? '…' : comment.resolved ? 'Reopen' : 'Resolve'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Delete comment"
              disabled={isResolving || isDeleting}
              onClick={onDeleteRequest}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommentsPanel({
  target,
  attachPassage = null,
  onPassageConsumed,
  embedded = false,
}: CommentsPanelProps) {
  const { data: comments, isLoading, error } = useComments(target);
  const createComment = useCreateComment(target);
  const patchComment = usePatchComment(target);
  const deleteComment = useDeleteComment(target);

  // Comment bodies are now rich HTML (text + images + annotations). `composerKey`
  // remounts the editor to clear it after a successful submit.
  const [bodyHtml, setBodyHtml] = useState('');
  const [composerKey, setComposerKey] = useState(0);
  const [attachedPassage, setAttachedPassage] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [commentToDelete, setCommentToDelete] = useState<SerializedComment | null>(null);

  // When the on-selection affordance hands in a passage, pre-attach it to the
  // composer and focus it, then let the parent clear the hand-off.
  useEffect(() => {
    if (attachPassage === null) {
      return;
    }
    setAttachedPassage(attachPassage);
    editorRef.current?.focus();
    onPassageConsumed?.();
  }, [attachPassage, onPassageConsumed]);

  const allComments = comments ?? [];
  const openComments = allComments.filter((c) => !c.resolved);
  const resolvedComments = allComments.filter((c) => c.resolved);

  const handleAttachSelection = () => {
    const selection = readSelection();
    if (selection !== null) {
      setAttachedPassage(selection);
    } else {
      toast('Select some text in the document first, then attach it.');
    }
  };

  const handleSubmit = () => {
    const html = bodyHtml;
    if (!commentHasContent(html)) {
      return;
    }
    const passage = attachedPassage ?? readSelection();
    createComment.mutate(passage !== null ? { body: html, passage } : { body: html }, {
      onSuccess: () => {
        toast('Comment added');
        setBodyHtml('');
        setComposerKey((key) => key + 1);
        setAttachedPassage(null);
      },
    });
  };

  const handleResolve = (comment: SerializedComment) => {
    setPendingActionId(comment.id);
    patchComment.mutate(
      { id: comment.id, input: { resolved: !comment.resolved } },
      {
        onSuccess: () => {
          toast(comment.resolved ? 'Comment reopened' : 'Comment resolved');
        },
        onSettled: () => {
          setPendingActionId(null);
        },
      },
    );
  };

  const confirmDelete = () => {
    if (commentToDelete === null) {
      return;
    }
    const target_id = commentToDelete.id;
    setPendingActionId(target_id);
    deleteComment.mutate(target_id, {
      onSuccess: () => {
        toast('Comment deleted');
        setCommentToDelete(null);
      },
      onSettled: () => {
        setPendingActionId(null);
      },
    });
  };

  return (
    <aside
      className={cn(
        'flex flex-col gap-3',
        embedded ? 'mt-3 w-full border-t pt-3' : 'h-full w-72 border-l pl-4',
      )}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-[12.5px] font-semibold">Comments</h2>
        <span className="text-[11px] text-muted-foreground">{openComments.length} open</span>
      </div>

      <div className="rounded-lg border bg-muted/30 p-2.5">
        {attachedPassage !== null ? (
          <div className="mb-2 flex items-start gap-1.5 rounded-md border bg-card p-1.5">
            <p className="flex-1 text-[12px] italic text-muted-foreground">&ldquo;{attachedPassage}&rdquo;</p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setAttachedPassage(null);
              }}
            >
              Clear
            </Button>
          </div>
        ) : null}
        <RichTextEditor
          key={composerKey}
          ref={editorRef}
          value=""
          mode="editor"
          bare
          minHeight="3rem"
          ariaLabel="Comment"
          onChange={setBodyHtml}
        />
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAttachSelection}
          >
            <PaperclipIcon className="size-3.5" /> Attach selection
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!commentHasContent(bodyHtml) || createComment.isPending}
            onClick={handleSubmit}
          >
            <CheckIcon className="size-3.5" /> Comment
          </Button>
        </div>
        {createComment.error !== null ? (
          <p role="alert" className="mt-1.5 text-[12px] text-destructive">
            {createComment.error.message}
          </p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {isLoading ? <p className="text-[12.5px] text-muted-foreground">Loading comments…</p> : null}
        {error !== null ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            Failed to load comments: {error.message}
          </p>
        ) : null}

        {!isLoading && error === null && allComments.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No comments yet — add one to leave feedback for teammates or an agent.
          </p>
        ) : null}

        {!isLoading && error === null && openComments.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Open
            </h3>
            {openComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onResolve={() => {
                  handleResolve(comment);
                }}
                onDeleteRequest={() => {
                  setCommentToDelete(comment);
                }}
                isResolving={patchComment.isPending && pendingActionId === comment.id}
                isDeleting={deleteComment.isPending && pendingActionId === comment.id}
              />
            ))}
          </div>
        ) : null}

        {!isLoading && error === null && resolvedComments.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto justify-start p-0 text-[12.5px]"
              onClick={() => {
                setShowResolved((value) => !value);
              }}
            >
              {showResolved ? 'Hide resolved' : `Show resolved (${String(resolvedComments.length)})`}
            </Button>
            {showResolved ? (
              resolvedComments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  onResolve={() => {
                    handleResolve(comment);
                  }}
                  onDeleteRequest={() => {
                    setCommentToDelete(comment);
                  }}
                  isResolving={patchComment.isPending && pendingActionId === comment.id}
                  isDeleting={deleteComment.isPending && pendingActionId === comment.id}
                />
              ))
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={commentToDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setCommentToDelete(null);
          }
        }}
        title="Delete this comment?"
        description="This cannot be undone."
        busy={deleteComment.isPending && commentToDelete !== null}
        onConfirm={confirmDelete}
      />
    </aside>
  );
}
