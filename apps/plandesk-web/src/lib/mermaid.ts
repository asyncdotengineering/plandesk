/**
 * Mermaid rendering for document bodies.
 *
 * The stored form is the contract: a mermaid diagram lives in a document as
 * `<pre><code class="language-mermaid">SOURCE</code></pre>`, which is what
 * `marked` produces from a ```mermaid fence and what Tiptap's code block
 * round-trips unchanged. Nothing here writes to the body — rendering is a view
 * concern applied after the body is on screen.
 *
 * Mermaid is ~3.5 MB minified, so it is loaded through a dynamic import and
 * lands in its own chunk. A document with no diagram never pays for it.
 */

export type MermaidResult = { svg: string } | { error: string };

export type MermaidRenderer = (source: string, id: string) => Promise<MermaidResult>;

const MERMAID_SELECTOR = 'pre > code.language-mermaid';
const RENDERED_FLAG = 'data-mermaid-state';

let mermaidReady: Promise<typeof import('mermaid').default> | undefined;
let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `mermaid-diagram-${String(sequence)}`;
}

async function loadMermaid(): Promise<typeof import('mermaid').default> {
  mermaidReady ??= import('mermaid').then((module) => {
    const mermaid = module.default;
    // startOnLoad:false — nothing scans the page; every render is explicit.
    // securityLevel:'strict' sanitises diagram labels and disables click
    // handlers, which matters because document bodies are user-authored.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return mermaid;
  });
  return mermaidReady;
}

/** Render one diagram. Never throws: a bad diagram is a result, not a failure. */
export async function renderMermaid(source: string, id: string): Promise<MermaidResult> {
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(id, source);
    return { svg };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Draw every mermaid block inside `container`, in place.
 *
 * `render` is injectable because mermaid needs layout APIs that jsdom does not
 * provide, so tests substitute it rather than skipping the sweep entirely.
 *
 * A diagram that renders replaces its `<pre>`. A diagram that fails keeps its
 * source visible and gains the message — an unreadable diagram is a problem the
 * author must see, and silently leaving a code block hides it.
 */
export async function renderMermaidIn(
  container: HTMLElement,
  render: MermaidRenderer = renderMermaid,
): Promise<void> {
  const blocks = [...container.querySelectorAll(MERMAID_SELECTOR)].filter((code) => {
    const pre = code.parentElement;
    return pre !== null && !pre.hasAttribute(RENDERED_FLAG);
  });

  await Promise.all(
    blocks.map(async (code) => {
      const pre = code.parentElement;
      if (pre === null) {
        return;
      }
      // textContent is already entity-decoded, which is what mermaid parses.
      const source = code.textContent;
      const result = await render(source, nextId());

      if ('error' in result) {
        pre.setAttribute(RENDERED_FLAG, 'error');
        const message = document.createElement('p');
        message.className = 'mermaid-error';
        message.setAttribute('role', 'status');
        message.textContent = result.error;
        pre.after(message);
        return;
      }

      const figure = document.createElement('figure');
      figure.className = 'mermaid-diagram';
      figure.setAttribute(RENDERED_FLAG, 'rendered');
      // Mermaid's own output, produced under securityLevel:'strict'. It cannot
      // pass through sanitizeHtml: DOMPurify's html profile drops <svg> whole.
      figure.innerHTML = result.svg;
      pre.replaceWith(figure);
    }),
  );
}
