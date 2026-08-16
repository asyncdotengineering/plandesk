import { describe, expect, it, vi } from 'vitest';
import { renderMermaidIn, type MermaidRenderer } from './mermaid.js';

function container(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

const MERMAID_BLOCK = '<pre><code class="language-mermaid">graph TD;\n  A--&gt;B;</code></pre>';

describe('renderMermaidIn', () => {
  it('replaces a mermaid block with the rendered diagram', async () => {
    const host = container(MERMAID_BLOCK);
    const render = vi.fn<MermaidRenderer>(() => Promise.resolve({ svg: '<svg id="drawn"></svg>' }));

    await renderMermaidIn(host, render);

    expect(host.querySelector('svg#drawn')).not.toBeNull();
    expect(host.querySelector('code.language-mermaid')).toBeNull();
    // The source the renderer receives must be the decoded text, not escaped HTML.
    expect(render.mock.calls[0]?.[0]).toBe('graph TD;\n  A-->B;');
  });

  it('keeps the source on screen and shows the message when a diagram fails', async () => {
    const host = container(MERMAID_BLOCK);

    await renderMermaidIn(host, () => Promise.resolve({ error: 'Parse error on line 2' }));

    expect(host.querySelector('code.language-mermaid')).not.toBeNull();
    expect(host.textContent).toContain('Parse error on line 2');
  });

  it('leaves code blocks in other languages alone', async () => {
    const host = container('<pre><code class="language-ts">const a = 1;</code></pre>');
    const render = vi.fn();

    await renderMermaidIn(host, render);

    expect(render).not.toHaveBeenCalled();
    expect(host.querySelector('code.language-ts')).not.toBeNull();
  });

  it('renders every mermaid block in the container', async () => {
    const host = container(`${MERMAID_BLOCK}<p>between</p>${MERMAID_BLOCK}`);

    await renderMermaidIn(host, (_source, id) =>
      Promise.resolve({ svg: `<svg data-id="${id}"></svg>` }),
    );

    expect(host.querySelectorAll('svg')).toHaveLength(2);
    // Ids must be unique: mermaid keys internal defs by id, so a repeated id
    // makes the second diagram inherit the first one's markers.
    const ids = [...host.querySelectorAll('svg')].map((svg) => svg.getAttribute('data-id'));
    expect(new Set(ids).size).toBe(2);
  });

  it('is safe to run twice on the same container', async () => {
    const host = container(MERMAID_BLOCK);
    const render = vi.fn<MermaidRenderer>(() => Promise.resolve({ svg: '<svg></svg>' }));

    await renderMermaidIn(host, render);
    await renderMermaidIn(host, render);

    expect(render).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('svg')).toHaveLength(1);
  });
});
