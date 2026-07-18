import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import {
  ArrowRightIcon,
  CheckIcon,
  EraserIcon,
  PencilLineIcon,
  SquareIcon,
  TypeIcon,
  Undo2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ANNOTATION_COLORS,
  flattenAnnotations,
  parseAnnotations,
  serializeAnnotations,
  type AnnotationShape,
} from './annotation-flatten.js';
// Registers the editor.storage.imageUpload augmentation used below.
import './image-upload.js';

type AnnotationTool = AnnotationShape['type'];

function newShapeId(): string {
  return `ann-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

function imagePoint(
  event: React.PointerEvent<SVGElement>,
  svg: SVGSVGElement,
  naturalW: number,
  naturalH: number,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * naturalW;
  const y = ((event.clientY - rect.top) / rect.height) * naturalH;
  return { x: Math.max(0, Math.min(naturalW, x)), y: Math.max(0, Math.min(naturalH, y)) };
}

function AnnotatableImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src = node.attrs.src as string;
  const alt = node.attrs.alt as string;
  const originalSrc = node.attrs.originalSrc as string | null;
  const storedAnnotations = node.attrs.annotations as string;

  const [hovered, setHovered] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [shapes, setShapes] = useState<AnnotationShape[]>(() => parseAnnotations(storedAnnotations));
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<AnnotationShape | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!annotating) {
      setShapes(parseAnnotations(storedAnnotations));
    }
  }, [storedAnnotations, annotating]);

  const baseSrc = originalSrc ?? src;

  const exitAnnotation = useCallback(async () => {
    if (saving) {
      return;
    }
    const blurShapes = shapes.filter((shape) => shape.type === 'blur');
    if (
      blurShapes.length >= 1 &&
      !window.confirm(
        "Blur redaction is permanent — redacted pixels are removed and can't be recovered. Save?",
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const { w, h } = naturalSize;
      const canFlatten = w > 0 && h > 0;
      // Blur/redact is destructive and permanent: bake it into the *persisted*
      // original so the un-redacted pixels are never stored. data-original ships
      // to the portal client, so keeping the raw image there would leak whatever
      // the user redacted. Arrows/boxes/text stay re-editable as overlay JSON.
      const overlayShapes = shapes.filter((shape) => shape.type !== 'blur');
      const persistedOriginal =
        canFlatten && blurShapes.length > 0
          ? await flattenAnnotations(baseSrc, blurShapes, w, h)
          : baseSrc;
      const displaySrc =
        canFlatten && overlayShapes.length > 0
          ? await flattenAnnotations(persistedOriginal, overlayShapes, w, h)
          : persistedOriginal;
      // Upload the flattened results to lean file URLs (no-op for already-hosted
      // or when no uploader is configured — the uploader returns its input).
      const upload =
        editor.storage.imageUpload?.uploader ?? ((value: string) => Promise.resolve(value));
      const persistedOriginalUrl = await upload(persistedOriginal);
      const displaySrcUrl =
        displaySrc === persistedOriginal ? persistedOriginalUrl : await upload(displaySrc);
      updateAttributes({
        src: displaySrcUrl,
        originalSrc: persistedOriginalUrl,
        annotations: serializeAnnotations(overlayShapes),
      });
    } finally {
      setSaving(false);
      setAnnotating(false);
      setDraft(null);
      setTextDraft(null);
      dragStartRef.current = null;
    }
  }, [baseSrc, editor, naturalSize, saving, shapes, updateAttributes]);

  useEffect(() => {
    if (!annotating) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void exitAnnotation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [annotating, exitAnnotation]);

  const commitText = () => {
    if (textDraft === null) {
      return;
    }
    const value = textDraft.value.trim();
    if (value !== '') {
      setShapes((current) => [
        ...current,
        {
          id: newShapeId(),
          type: 'text',
          x: textDraft.x,
          y: textDraft.y,
          w: 0,
          h: 18,
          text: value,
          color,
        },
      ]);
    }
    setTextDraft(null);
  };

  const onPointerDown = (event: React.PointerEvent<SVGElement>) => {
    if (!annotating || naturalSize.w === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    if (svg === null) {
      return;
    }
    const point = imagePoint(event, svg, naturalSize.w, naturalSize.h);
    if (tool === 'text') {
      commitText();
      setTextDraft({ x: point.x, y: point.y, value: '' });
      return;
    }
    dragStartRef.current = point;
    setDraft({
      id: newShapeId(),
      type: tool,
      x: point.x,
      y: point.y,
      w: 0,
      h: 0,
      color,
    });
    svg.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGElement>) => {
    if (!annotating || dragStartRef.current === null || tool === 'text') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    if (svg === null) {
      return;
    }
    const point = imagePoint(event, svg, naturalSize.w, naturalSize.h);
    const start = dragStartRef.current;
    if (tool === 'arrow') {
      setDraft({
        id: draft?.id ?? newShapeId(),
        type: 'arrow',
        x: start.x,
        y: start.y,
        w: point.x - start.x,
        h: point.y - start.y,
        color,
      });
      return;
    }
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    setDraft({
      id: draft?.id ?? newShapeId(),
      type: tool,
      x,
      y,
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
      color,
    });
  };

  const onPointerUp = (event: React.PointerEvent<SVGElement>) => {
    if (!annotating || dragStartRef.current === null || tool === 'text') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    if (svg !== null) {
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch {
        // pointer may already be released in jsdom
      }
    }
    if (draft !== null && (Math.abs(draft.w) > 4 || Math.abs(draft.h) > 4)) {
      setShapes((current) => [...current, draft]);
    }
    setDraft(null);
    dragStartRef.current = null;
  };

  const renderShape = (shape: AnnotationShape, key: string) => {
    if (shape.type === 'arrow') {
      const x2 = shape.x + shape.w;
      const y2 = shape.y + shape.h;
      const angle = Math.atan2(y2 - shape.y, x2 - shape.x);
      const head = Math.min(14, Math.hypot(shape.w, shape.h) * 0.25);
      const hx1 = x2 - head * Math.cos(angle - Math.PI / 6);
      const hy1 = y2 - head * Math.sin(angle - Math.PI / 6);
      const hx2 = x2 - head * Math.cos(angle + Math.PI / 6);
      const hy2 = y2 - head * Math.sin(angle + Math.PI / 6);
      return (
        <g key={key}>
          <line
            x1={shape.x}
            y1={shape.y}
            x2={x2}
            y2={y2}
            stroke={shape.color}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <polygon
            points={[x2, y2, hx1, hy1, hx2, hy2].map((value) => String(value)).join(' ')}
            fill={shape.color}
          />
        </g>
      );
    }
    if (shape.type === 'rect') {
      return (
        <rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          fill="none"
          stroke={shape.color}
          strokeWidth={3}
        />
      );
    }
    if (shape.type === 'text') {
      return (
        <text
          key={key}
          x={shape.x}
          y={shape.y + 18}
          fill={shape.color}
          fontSize={18}
          fontWeight={600}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {shape.text}
        </text>
      );
    }
    return (
      <rect
        key={key}
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        fill="var(--muted)"
        stroke="var(--border-strong)"
        strokeWidth={2}
        strokeDasharray="6 4"
        opacity={0.85}
      />
    );
  };

  const displayShapes = draft !== null ? [...shapes, draft] : shapes;

  return (
    <NodeViewWrapper
      as="div"
      className="annotatable-image-wrapper"
      data-selected={selected ? 'true' : undefined}
      contentEditable={false}
      draggable={!annotating}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        if (!annotating) {
          setHovered(false);
        }
      }}
    >
      <div className="annotatable-image-frame">
        <img
          src={src}
          alt={alt}
          className="annotatable-image-img"
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
        />

        {!annotating && hovered ? (
          <div className="annotatable-image-hover">
            <Button
              type="button"
              size="sm"
              className="shadow-md"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                setAnnotating(true);
                setHovered(false);
              }}
            >
              <PencilLineIcon className="size-3.5" />
              Annotate
            </Button>
          </div>
        ) : null}

        {annotating && naturalSize.w > 0 ? (
          <>
            <svg
              ref={svgRef}
              className="annotatable-image-overlay"
              viewBox={`0 0 ${String(naturalSize.w)} ${String(naturalSize.h)}`}
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {displayShapes.map((shape) => renderShape(shape, shape.id))}
            </svg>

            {textDraft !== null ? (
              <input
                type="text"
                className="annotatable-image-text-input"
                autoFocus
                value={textDraft.value}
                placeholder="Label…"
                style={{
                  left: `${String((textDraft.x / naturalSize.w) * 100)}%`,
                  top: `${String((textDraft.y / naturalSize.h) * 100)}%`,
                  color,
                }}
                onChange={(event) => {
                  setTextDraft((current) =>
                    current === null ? current : { ...current, value: event.target.value },
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitText();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setTextDraft(null);
                  }
                }}
                onBlur={commitText}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
              />
            ) : null}

            <div
              className="annotatable-image-toolbar"
              role="toolbar"
              aria-label="Image annotation tools"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
            >
              <Button
                type="button"
                size="icon-xs"
                variant={tool === 'arrow' ? 'default' : 'ghost'}
                aria-pressed={tool === 'arrow'}
                aria-label="Arrow"
                onClick={() => {
                  setTool('arrow');
                }}
              >
                <ArrowRightIcon />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant={tool === 'rect' ? 'default' : 'ghost'}
                aria-pressed={tool === 'rect'}
                aria-label="Box"
                onClick={() => {
                  setTool('rect');
                }}
              >
                <SquareIcon />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant={tool === 'text' ? 'default' : 'ghost'}
                aria-pressed={tool === 'text'}
                aria-label="Text label"
                onClick={() => {
                  setTool('text');
                }}
              >
                <TypeIcon />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant={tool === 'blur' ? 'default' : 'ghost'}
                aria-pressed={tool === 'blur'}
                aria-label="Blur redact"
                onClick={() => {
                  setTool('blur');
                }}
              >
                <EraserIcon />
              </Button>

              <span className="annotatable-image-toolbar-divider" aria-hidden />

              {ANNOTATION_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="annotatable-image-color-swatch"
                  aria-label={`Color ${preset}`}
                  aria-pressed={color === preset}
                  style={{ background: preset }}
                  onClick={() => {
                    setColor(preset);
                  }}
                />
              ))}

              <span className="annotatable-image-toolbar-divider" aria-hidden />

              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Undo"
                disabled={shapes.length === 0}
                onClick={() => {
                  setShapes((current) => current.slice(0, -1));
                }}
              >
                <Undo2Icon />
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void exitAnnotation()}
              >
                <CheckIcon className="size-3.5" />
                Done
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

export const AnnotatableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      annotations: {
        default: '[]',
        parseHTML: (element) => element.getAttribute('data-annotations') ?? '[]',
        renderHTML: (attributes) => {
          const value = attributes.annotations as string | undefined;
          if (value === undefined || value === '[]') {
            return {};
          }
          return { 'data-annotations': value };
        },
      },
      originalSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original'),
        renderHTML: (attributes) => {
          const value = attributes.originalSrc as string | null | undefined;
          if (value === null || value === undefined || value === '') {
            return {};
          }
          return { 'data-original': value };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(AnnotatableImageNodeView);
  },
}).configure({ allowBase64: true });