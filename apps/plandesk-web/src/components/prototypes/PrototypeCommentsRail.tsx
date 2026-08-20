/**
 * Prototype canvas comments rail — reuses CommentsPanel against the artifact
 * comment path. Pending Comment-mode drafts pre-fill passage + anchor.
 */
import { useCallback, useMemo } from 'react';
import { CommentsPanel } from '@/components/docs/CommentsPanel.js';
import type { CommentTarget } from '@/lib/api.js';
import { usePendingAnchor, useScreenCommentsStore } from './ScreenCommentsContext.js';
import { passageFromSelector } from './screen-comments.js';

export function PrototypeCommentsRail({
  projectId,
  defaultArtifactId,
  commentTargetForArtifact,
  canManage = true,
}: {
  projectId: string;
  /** Focused / selected screen — falls back when no pending draft. */
  defaultArtifactId: string | null;
  commentTargetForArtifact?: (artifactId: string) => CommentTarget;
  canManage?: boolean;
}) {
  const pending = usePendingAnchor();
  const store = useScreenCommentsStore();

  const artifactId = pending?.artifactId ?? defaultArtifactId;

  const target: CommentTarget | null = useMemo(() => {
    if (artifactId === null) {
      return null;
    }
    return (
      commentTargetForArtifact?.(artifactId) ?? { type: 'artifact', id: artifactId, projectId }
    );
  }, [artifactId, commentTargetForArtifact, projectId]);

  const attachPassage = pending !== null ? (passageFromSelector(pending.selector) ?? null) : null;
  const attachAnchor = pending !== null ? JSON.stringify(pending.selector) : null;

  const clearPending = useCallback(() => {
    store.setPending(null);
  }, [store]);

  if (target === null) {
    return (
      <aside
        className="flex h-full w-72 flex-col border-l pl-4 text-[12.5px] text-muted-foreground"
        data-prototype-comments-rail
      >
        <p>Select a screen or annotate in Comment mode.</p>
      </aside>
    );
  }

  return (
    <div
      className="h-full min-h-0 shrink-0"
      data-prototype-comments-rail
      data-artifact-id={target.id}
    >
      <CommentsPanel
        target={target}
        embedded={false}
        attachPassage={attachPassage}
        attachAnchor={attachAnchor}
        onPassageConsumed={attachPassage !== null ? clearPending : undefined}
        onAnchorConsumed={attachPassage === null ? clearPending : undefined}
        canManage={canManage}
      />
    </div>
  );
}
