import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MermaidCodeBlock } from './MermaidCodeBlock.js';

const STORED = '<pre><code class="language-mermaid">graph TD;\n  A--&gt;B;</code></pre>';

function editorWith(content: string): Editor {
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), MermaidCodeBlock],
    content,
  });
}

describe('MermaidCodeBlock', () => {
  it('owns the codeBlock node name so StarterKit cannot double-register it', () => {
    expect(MermaidCodeBlock.name).toBe('codeBlock');
    // Registering both would throw "Duplicate extension names"; proving the
    // configured pair constructs is the guard against re-enabling it by mistake.
    expect(() => {
      editorWith(STORED).destroy();
    }).not.toThrow();
  });

  it('round-trips a mermaid block byte-identical', () => {
    const editor = editorWith(STORED);
    const out = editor.getHTML();
    editor.destroy();
    expect(out).toBe(STORED);
  });

  it('keeps the language attribute so the node view can tell mermaid apart', () => {
    const editor = editorWith(STORED);
    const json = editor.getJSON();
    editor.destroy();
    expect(json.content[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'mermaid' },
    });
  });

  it('still handles a plain code block', () => {
    const plain = '<pre><code>const a = 1;</code></pre>';
    const editor = editorWith(plain);
    const out = editor.getHTML();
    editor.destroy();
    expect(out).toContain('const a = 1;');
  });
});
