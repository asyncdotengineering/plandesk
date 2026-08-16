import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotatableImage } from './AnnotatableImage.js';
import {
  arrowEndpoints,
  flattenAnnotations,
  hitAnnotationAt,
  normalizeRectBounds,
  parseAnnotations,
  serializeAnnotations,
  shapeBounds,
  type AnnotationShape,
} from './annotation-flatten.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  const el = window.Element.prototype as unknown as Record<string, unknown>;
  el.hasPointerCapture ??= vi.fn(() => false);
  el.setPointerCapture ??= vi.fn();
  el.releasePointerCapture ??= vi.fn();
  el.scrollIntoView ??= vi.fn();
});

function createImageEditor(content?: string) {
  return new Editor({
    extensions: [StarterKit, AnnotatableImage],
    content: content ?? '<p></p>',
  });
}

function firstImageNode(editor: Editor) {
  let found: ReturnType<Editor['state']['doc']['descendants']> extends never ? never : unknown =
    undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') {
      found = node;
      return false;
    }
    return true;
  });
  return found as { type: { name: string }; attrs: Record<string, unknown> } | undefined;
}

describe('annotation geometry helpers', () => {
  it('normalizes rect bounds regardless of drag direction', () => {
    expect(normalizeRectBounds(10, 20, 50, 80)).toEqual({ x: 10, y: 20, w: 40, h: 60 });
    expect(normalizeRectBounds(50, 80, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it('derives arrow endpoints from shape vector', () => {
    const shape: AnnotationShape = {
      id: 'a1',
      type: 'arrow',
      x: 5,
      y: 10,
      w: 30,
      h: -15,
      color: 'var(--primary)',
    };
    expect(arrowEndpoints(shape)).toEqual({ x1: 5, y1: 10, x2: 35, y2: -5 });
    expect(shapeBounds(shape)).toEqual({ x: 5, y: -5, w: 30, h: 15 });
  });

  it('estimates text bounds from label content', () => {
    const shape: AnnotationShape = {
      id: 't1',
      type: 'text',
      x: 12,
      y: 24,
      w: 0,
      h: 18,
      text: 'Hi',
      color: 'var(--primary)',
    };
    const bounds = shapeBounds(shape);
    expect(bounds.x).toBe(12);
    expect(bounds.y).toBe(24);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
  });

  it('hitAnnotationAt returns the topmost shape under the pointer', () => {
    const bottom: AnnotationShape = {
      id: 'bottom',
      type: 'rect',
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      color: 'var(--primary)',
    };
    const top: AnnotationShape = {
      id: 'top',
      type: 'rect',
      x: 10,
      y: 10,
      w: 40,
      h: 40,
      color: 'var(--destructive)',
    };
    expect(hitAnnotationAt([bottom, top], 20, 20)?.id).toBe('top');
    expect(hitAnnotationAt([bottom, top], 2, 2)?.id).toBe('bottom');
  });

  it('translating a selected shape updates coordinates without adding a new one', () => {
    const shape: AnnotationShape = {
      id: 'move-me',
      type: 'rect',
      x: 10,
      y: 10,
      w: 30,
      h: 20,
      color: 'var(--primary)',
    };
    const grabOffset = { x: 5, y: 5 };
    const moved = [{ ...shape, x: 40 - grabOffset.x, y: 50 - grabOffset.y }];
    expect(moved).toHaveLength(1);
    expect(moved[0]?.x).toBe(35);
    expect(moved[0]?.y).toBe(45);
    expect(hitAnnotationAt(moved, 40, 50)?.id).toBe('move-me');
  });
});

describe('AnnotatableImage extension', () => {
  it('round-trips annotations and originalSrc through getHTML', () => {
    const annotations: AnnotationShape[] = [
      {
        id: 's1',
        type: 'rect',
        x: 4,
        y: 8,
        w: 40,
        h: 20,
        color: 'var(--destructive)',
      },
    ];
    const serialized = serializeAnnotations(annotations);
    const original = 'data:image/png;base64,AAAA';
    const editor = createImageEditor(
      `<img src="${original}" alt="diagram" data-original="${original}" data-annotations='${serialized.replace(/'/g, '&#39;')}'>`,
    );

    const html = editor.getHTML();
    expect(html).toContain('data-original');
    expect(html).toContain('data-annotations');
    expect(html).toContain('alt="diagram"');

    const imageNode = firstImageNode(editor);
    expect(imageNode?.type.name).toBe('image');
    expect(imageNode?.attrs.originalSrc).toBe(original);
    expect(parseAnnotations(imageNode?.attrs.annotations as string)).toEqual(annotations);

    editor.destroy();
  });

  it('parses legacy images without annotation attrs', () => {
    const legacySrc = 'data:image/png;base64,legacy';
    const editor = createImageEditor(`<img src="${legacySrc}" alt="old">`);

    const imageNode = firstImageNode(editor);
    expect(imageNode?.type.name).toBe('image');
    expect(imageNode?.attrs.src).toBe(legacySrc);
    expect(imageNode?.attrs.annotations).toBe('[]');
    expect(imageNode?.attrs.originalSrc).toBeNull();

    const html = editor.getHTML();
    expect(html).toContain(`src="${legacySrc}"`);
    expect(html).not.toContain('data-annotations');

    editor.destroy();
  });

  it('inserts new images with originalSrc and empty annotations', () => {
    const editor = createImageEditor();
    const dataUrl = 'data:image/png;base64,NEW';
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: dataUrl,
                alt: 'upload.png',
                originalSrc: dataUrl,
                annotations: '[]',
              },
            },
          ],
        },
      ],
    });

    const imageNode = editor.state.doc.firstChild?.firstChild;
    expect(imageNode?.attrs.originalSrc).toBe(dataUrl);
    expect(imageNode?.attrs.annotations).toBe('[]');

    const html = editor.getHTML();
    expect(html).toContain(`data-original="${dataUrl}"`);
    expect(html).toContain(`src="${dataUrl}"`);

    editor.destroy();
  });
});

describe('flattenAnnotations', () => {
  it('returns the original src when canvas is unavailable (jsdom)', async () => {
    const original = 'data:image/png;base64,flat';
    const shapes: AnnotationShape[] = [
      {
        id: 'b1',
        type: 'blur',
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        color: 'var(--muted-foreground)',
      },
    ];
    const result = await flattenAnnotations(original, shapes, 100, 80);
    expect(result).toBe(original);
  });

  it('returns the original src for empty annotations', async () => {
    const original = 'data:image/png;base64,plain';
    const result = await flattenAnnotations(original, [], 100, 80);
    expect(result).toBe(original);
  });
});
