import { useEffect, useRef } from 'react';
import { artifactRenderSrc } from '../../lib/artifact-frame.js';
import { bodyToHtml } from '../../lib/markdown.js';
import { renderMermaidIn } from '../../lib/mermaid.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import type { SerializedArtifactSummary } from '../../lib/api.js';
import './document-editor.css';

type ArtifactViewProps = {
  artifact: SerializedArtifactSummary;
  /** Markdown body. Unused for kind 'html', which renders from its own route. */
  body: string;
  /** Share-scoped read token, when there is no session. */
  frameToken?: string;
};

/**
 * A filed artifact, opened from the document tree.
 *
 * An HTML artifact renders in the sandboxed frame it was always served from.
 * Its content deliberately does NOT pass through `sanitizeHtml`: DOMPurify's
 * html profile strips `<style>`, `<script>` and `<svg>`, which is most of what
 * a report is made of. The frame's CSP is the boundary instead, and the
 * `sandbox` attribute is the other half — never `allow-same-origin`.
 *
 * A markdown artifact is rich text, so it takes the ordinary document path.
 */
export function ArtifactView({ artifact, body, frameToken }: ArtifactViewProps) {
  const markdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (artifact.kind !== 'markdown') {
      return;
    }
    const container = markdownRef.current;
    if (container === null) {
      return;
    }
    void renderMermaidIn(container);
  }, [artifact.kind, body]);

  if (artifact.kind === 'html') {
    return (
      <iframe
        title={artifact.title}
        sandbox="allow-scripts"
        src={artifactRenderSrc(artifact.id, artifact.revision_id, frameToken)}
        className="h-[calc(100vh-12rem)] w-full rounded-lg border border-border bg-white"
        data-artifact-frame
        data-artifact-id={artifact.id}
      />
    );
  }

  return (
    <div
      ref={markdownRef}
      className="document-reader-content rounded-lg border border-border bg-card p-4 leading-relaxed"
      aria-label={artifact.title}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyToHtml(body)) }}
    />
  );
}
