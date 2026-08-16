import { CodeBlock } from '@tiptap/extension-code-block';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from '@tiptap/react';
import { useEffect, useMemo, useState } from 'react';
import { renderMermaid, type MermaidResult } from '../../lib/mermaid.js';

const MERMAID_LANGUAGE = 'mermaid';
// Long enough that a diagram is not re-parsed on every keystroke, short enough
// that the preview feels immediate once typing stops.
const RENDER_DEBOUNCE_MS = 300;

let sequence = 0;

function MermaidNodeView({ node, editor, getPos }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  const isMermaid = language === MERMAID_LANGUAGE;
  const source = node.textContent;
  const diagramId = useMemo(() => {
    sequence += 1;
    return `mermaid-node-${String(sequence)}`;
  }, []);

  // Editing happens when the caret is inside this block. A code block takes a
  // TextSelection rather than a NodeSelection, so the `selected` prop stays
  // false while typing — the range has to be compared directly.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const sync = (): void => {
      const pos = getPos();
      if (typeof pos !== 'number') {
        setEditing(false);
        return;
      }
      const { from, to } = editor.state.selection;
      setEditing(from >= pos && to <= pos + node.nodeSize);
    };
    sync();
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor, getPos, node]);

  const [diagram, setDiagram] = useState<MermaidResult | null>(null);
  useEffect(() => {
    if (!isMermaid || source.trim() === '') {
      setDiagram(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderMermaid(source, diagramId).then((result) => {
        if (!cancelled) {
          setDiagram(result);
        }
      });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isMermaid, source, diagramId]);

  const drawn = diagram !== null && 'svg' in diagram ? diagram.svg : null;
  const failed = diagram !== null && 'error' in diagram ? diagram.error : null;
  // Source stays on screen while editing, and whenever there is no diagram to
  // put in its place — a failed parse must never hide what the author wrote.
  const showSource = !isMermaid || editing || drawn === null;

  return (
    <NodeViewWrapper className="mermaid-block" data-language={language}>
      {isMermaid && drawn !== null && !editing ? (
        <figure
          className="mermaid-diagram"
          // Mermaid's own output, produced under securityLevel:'strict'. It
          // cannot pass through sanitizeHtml — DOMPurify's html profile drops
          // <svg> whole.
          dangerouslySetInnerHTML={{ __html: drawn }}
          onClick={() => {
            const pos = getPos();
            if (typeof pos === 'number') {
              editor.commands.setTextSelection(pos + 1);
              editor.commands.focus();
            }
          }}
        />
      ) : null}
      <pre style={showSource ? undefined : { display: 'none' }}>
        <NodeViewContent<'code'>
          as="code"
          className={language === null ? undefined : `language-${language}`}
        />
      </pre>
      {failed !== null && editing ? (
        <p className="mermaid-error" role="status">
          {failed}
        </p>
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * The document's code block, with a mermaid preview.
 *
 * It keeps the node name `codeBlock` and the stored form
 * `<pre><code class="language-mermaid">` unchanged, so existing bodies render
 * with no migration and a diagram round-trips byte-identical. StarterKit must
 * be configured with `codeBlock: false` — two extensions claiming one node name
 * is a duplicate-name error at editor construction.
 */
export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
